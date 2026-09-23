import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosError, AxiosResponse } from 'axios';
import { firstValueFrom } from 'rxjs';
import type { HaciendaSubmissionConfig } from '../../../../infrastructure/config/hacienda-submission.config';
import { classifyRecepcionStatus } from './hacienda-recepcion-status.table';
import { parseMensajeHacienda } from './hacienda-mensajehacienda-parser';
import type { HaciendaEnvironment } from '../../domain/fiscal.constants';
import type {
  HaciendaQueryStatusInput,
  HaciendaRateLimitMetadata,
  HaciendaSubmissionPort,
  HaciendaSubmissionResult,
  HaciendaSubmitSignedDocumentInput,
} from '../../application/submission/ports/hacienda-submission.port';

/**
 * Transport DTO for a party (emisor / receptor) in the POST /recepcion envelope.
 *
 * Hacienda's CE API deserializes tipoIdentificacion as java.lang.String.
 * It MUST be a flat scalar string, NOT a nested object.
 *
 *   CORRECT:   { tipoIdentificacion: "02", numeroIdentificacion: "3101123456" }
 *   WRONG:     { tipoIdentificacion: { tipo: "02", numero: "3101123456" } }
 *
 * The XML schema uses a nested <Identificacion><Tipo/><Numero/></Identificacion>
 * element — that is a DIFFERENT contract and MUST NOT bleed into this DTO.
 */
interface HaciendaPartyRequest {
  readonly tipoIdentificacion: string;
  readonly numeroIdentificacion: string;
}

interface HaciendaSubmissionRequest {
  readonly clave: string;
  readonly fecha: string;
  readonly emisor: HaciendaPartyRequest;
  readonly comprobanteXml: string;
  readonly receptor?: HaciendaPartyRequest;
  readonly callbackUrl?: string;
  readonly consecutivoReceptor?: string;
}

interface HaciendaStatusResponse {
  readonly clave?: string;
  readonly fecha?: string;
  readonly 'ind-estado'?: string;
  readonly 'respuesta-xml'?: string;
}

@Injectable()
export class HaciendaRecepcionAdapter implements HaciendaSubmissionPort {
  private readonly config: HaciendaSubmissionConfig;

  constructor(
    private readonly configService: ConfigService,
    private readonly http: HttpService,
  ) {
    this.config = configService.get<HaciendaSubmissionConfig>('haciendaSubmission')!;
  }

  async submitSignedDocument(
    input: HaciendaSubmitSignedDocumentInput,
  ): Promise<HaciendaSubmissionResult> {
    const body: HaciendaSubmissionRequest = {
      clave: input.clave,
      fecha: input.issueDate.toISOString(),
      emisor: this.mapParty(input.issuer),
      comprobanteXml: input.signedXml.toString('base64'),
      ...(input.receiver ? { receptor: this.mapParty(input.receiver) } : {}),
      ...((input.callbackUrl ?? this.config.callbackUrl)
        ? { callbackUrl: input.callbackUrl ?? this.config.callbackUrl }
        : {}),
      ...(input.consecutivoReceptor ? { consecutivoReceptor: input.consecutivoReceptor } : {}),
    };

    try {
      const response = await firstValueFrom(
        this.http.post(this.url(input.environment, 'recepcion'), body, {
          timeout: this.config.timeoutMs,
          headers: {
            Authorization: `bearer ${input.accessToken}`,
            'Content-Type': 'application/json; charset=utf-8',
          },
        }),
      );

      if (response.status === 201) {
        return {
          kind: 'ACKNOWLEDGED',
          nextStatus: 'ACKNOWLEDGED',
          httpStatus: response.status,
          providerLocation: this.headerValue(response, 'location'),
          providerReference: input.clave,
          responseClassification: 'DOCUMENTED_SUCCESSFUL_RECEIPT',
          rateLimit: this.extractRateLimit(response),
        };
      }

      // Any 2xx other than 201 is NOT documented in the Hacienda POST /recepcion
      // contract.  MUST NOT be treated as ACKNOWLEDGED or ACCEPTED.
      // Preserve safe headers and reconcile via GET /recepcion/{clave}.
      if (response.status >= 200 && response.status < 300) {
        const info = classifyRecepcionStatus(response.status);
        return {
          kind: 'UNRESOLVED_PROVIDER_RESPONSE',
          nextStatus: 'POST_OUTCOME_UNKNOWN',
          httpStatus: response.status,
          providerLocation: this.headerValue(response, 'location'),
          providerReference: input.clave,
          normalizedErrorCode: 'HACIENDA_UNDOCUMENTED_2XX_STATUS',
          sanitizedErrorMessage:
            `Hacienda returned HTTP ${response.status}: ${info.meaning}`,
          responseClassification: info.classification,
          providerMetadata: {
            responseClassification: info.classification,
            ...this.extractSafeSuccessHeaders(response),
          },
          rateLimit: this.extractRateLimit(response),
        };
      }

      return this.nonRetryable(response.status, 'HACIENDA_UNEXPECTED_POST_STATUS');
    } catch (error: unknown) {
      return this.mapHttpError(error, 'POST');
    }
  }

  async queryStatusByClave(input: HaciendaQueryStatusInput): Promise<HaciendaSubmissionResult> {
    try {
      const response = await firstValueFrom(
        this.http.get<HaciendaStatusResponse>(
          this.url(input.environment, `recepcion/${input.clave}`),
          {
            timeout: this.config.timeoutMs,
            headers: { Authorization: `bearer ${input.accessToken}` },
          },
        ),
      );

      return this.mapStatusResponse(response);
    } catch (error: unknown) {
      return this.mapHttpError(error, 'GET');
    }
  }

  private mapStatusResponse(
    response: AxiosResponse<HaciendaStatusResponse>,
  ): HaciendaSubmissionResult {
    const providerStatus = response.data['ind-estado'];
    const base = {
      httpStatus: response.status,
      providerStatus,
      rateLimit: this.extractRateLimit(response),
    };

    if (providerStatus === 'recibido' || providerStatus === 'procesando') {
      return { ...base, kind: 'PROCESSING', nextStatus: 'PROCESSING' };
    }

    if (providerStatus === 'aceptado') {
      const artifact = this.decodeResponseArtifact(response.data['respuesta-xml']);
      return {
        ...base,
        kind: 'ACCEPTED',
        nextStatus: 'ACCEPTED',
        responseArtifact: artifact,
        providerMetadata: this.extractFiscalDiagnostic(artifact?.content),
      };
    }

    if (providerStatus === 'rechazado') {
      const artifact = this.decodeResponseArtifact(response.data['respuesta-xml']);
      return {
        ...base,
        kind: 'REJECTED',
        nextStatus: 'REJECTED',
        responseArtifact: artifact,
        providerMetadata: this.extractFiscalDiagnostic(artifact?.content),
      };
    }

    return {
      ...base,
      kind: 'NON_RETRYABLE_FAILURE',
      nextStatus: 'MANUAL_REVIEW_REQUIRED',
      normalizedErrorCode: 'HACIENDA_UNKNOWN_STATUS',
      sanitizedErrorMessage: 'Hacienda returned an unsupported status.',
    };
  }

  /**
   * Parses a MensajeHacienda XML artifact and returns safe fiscal diagnostic
   * fields for inclusion in providerMetadata.
   *
   * Returns undefined when the artifact is absent or yields no safe fields.
   * A parse failure (parseError set) is surfaced as a metadata field so it
   * can be investigated — it MUST NOT affect the state transition.
   */
  private extractFiscalDiagnostic(
    content: Buffer | undefined,
  ): Record<string, string | number | boolean | null> | undefined {
    if (!content) return undefined;
    const { diagnostic, parseError } = parseMensajeHacienda(content);
    const meta: Record<string, string | number | boolean | null> = {};
    if (diagnostic.mensaje !== undefined) meta['haciendaMensaje'] = diagnostic.mensaje;
    if (diagnostic.detalleMensaje !== undefined) meta['haciendaDetalleMensaje'] = diagnostic.detalleMensaje;
    if (diagnostic.estadoMensaje !== undefined) meta['haciendaEstadoMensaje'] = diagnostic.estadoMensaje;
    if (parseError) meta['fiscalDiagnosticParseError'] = parseError;
    return Object.keys(meta).length > 0 ? meta : undefined;
  }

  private mapParty(party: HaciendaSubmitSignedDocumentInput['issuer']): HaciendaPartyRequest {
    // tipoIdentificacion MUST be a scalar string (Hacienda java.lang.String).
    // numeroIdentificacion MUST be a separate sibling scalar string.
    // Root cause of F4-S TASK-009 HTTP 400: previously sent an object here.
    return {
      tipoIdentificacion: party.identification.type,
      numeroIdentificacion: party.identification.number,
    };
  }

  private url(environment: HaciendaEnvironment, path: string): string {
    const baseUrl =
      environment === 'PRODUCTION' ? this.config.productionBaseUrl : this.config.sandboxBaseUrl;
    return `${baseUrl.replace(/\/$/, '')}/${path}`;
  }

  private decodeResponseArtifact(
    encodedResponse?: string,
  ): { content: Buffer; contentType: string } | undefined {
    if (!encodedResponse) {
      return undefined;
    }

    return { content: Buffer.from(encodedResponse, 'base64'), contentType: 'application/xml' };
  }

  private mapHttpError(error: unknown, operation: 'POST' | 'GET'): HaciendaSubmissionResult {
    const axiosError = error as AxiosError;
    const status = axiosError.response?.status;

    if (status === 401) {
      return {
        ...this.retryable(status, 'HACIENDA_TOKEN_EXPIRED'),
        responseClassification: 'DOCUMENTED_AUTH_ERROR',
      };
    }

    if (status === 429) {
      return {
        ...this.retryable(status, 'HACIENDA_RATE_LIMIT'),
        rateLimit: axiosError.response ? this.extractRateLimit(axiosError.response) : undefined,
      };
    }

    if (status !== undefined && status >= 500) {
      return operation === 'POST'
        ? {
            kind: 'AMBIGUOUS_FAILURE',
            nextStatus: 'POST_OUTCOME_UNKNOWN',
            httpStatus: status,
            normalizedErrorCode: 'HACIENDA_POST_OUTCOME_UNKNOWN',
            sanitizedErrorMessage: 'Hacienda POST outcome is unknown and must be reconciled.',
          }
        : this.retryable(status, 'HACIENDA_UNAVAILABLE');
    }

    if (status !== undefined) {
      const providerDiagnostic = this.extractProviderDiagnostic(axiosError.response);
      const { classification } = classifyRecepcionStatus(status);
      return {
        ...this.nonRetryable(status, 'HACIENDA_NON_RETRYABLE_ERROR'),
        responseClassification: classification,
        ...(providerDiagnostic ? { providerMetadata: providerDiagnostic } : {}),
      };
    }

    return operation === 'POST'
      ? {
          kind: 'AMBIGUOUS_FAILURE',
          nextStatus: 'POST_OUTCOME_UNKNOWN',
          normalizedErrorCode: 'HACIENDA_POST_OUTCOME_UNKNOWN',
          sanitizedErrorMessage: 'Hacienda POST outcome is unknown and must be reconciled.',
        }
      : this.retryable(undefined, 'HACIENDA_NETWORK_ERROR');
  }

  private retryable(
    httpStatus: number | undefined,
    normalizedErrorCode: string,
  ): HaciendaSubmissionResult {
    return {
      kind: 'RETRYABLE_FAILURE',
      nextStatus: 'TECHNICAL_RETRY_PENDING',
      httpStatus,
      normalizedErrorCode,
      sanitizedErrorMessage: 'Hacienda request failed with a retryable technical error.',
    };
  }

  // ── Provider diagnostic extraction ────────────────────────────────────────
  //
  // SAFETY CONTRACT:
  //   - Key names only are captured in structural shape fields.
  //   - String values are only captured for an explicit allowlist of safe fields.
  //   - All captured strings are sanitized (XML stripped, length capped).
  //   - authorization, set-cookie, cookie, token headers are NEVER read.
  //   - Raw body, XML, certificate data, or signatures are NEVER persisted.
  //   - Buffer / Uint8Array bodies are decoded only under a strict size limit.
  //   - JSON.parse is only attempted on bounded inputs.

  /**
   * Top-level entry point.
   *
   * Extraction order (all steps independent of each other):
   *   1. Safe response headers: only x-error-cause is allowlisted.
   *   2. Body content-type.
   *   3. Body structural shape (key names only, depth ≤ 2).
   *   4. Allowlisted body field values (sanitized strings only).
   *
   * Header extraction happens BEFORE body parsing so that diagnostics
   * are available even when the body is empty.
   */
  private extractProviderDiagnostic(
    response: AxiosError['response'] | undefined,
  ): Record<string, string | number | boolean | null> | null {
    if (!response) return null;

    const diagnostic: Record<string, string | number | boolean | null> = {};

    // ── Step 1: Allowlisted response headers ──────────────────────────────
    // ONLY the explicit allowlist below is extracted. All other headers are ignored.
    const errorCause = this.readSafeResponseHeader(response.headers, 'x-error-cause');
    if (errorCause !== undefined) {
      diagnostic['haciendaErrorCause'] = this.sanitizeHeaderValue(errorCause);
    }
    // validation-exception: documented companion header for HTTP 400 in Hacienda contract
    const validationException = this.readSafeResponseHeader(response.headers, 'validation-exception');
    if (validationException !== undefined) {
      diagnostic['haciendaValidationException'] = this.sanitizeHeaderValue(validationException);
    }

    // ── Step 2: Content-type ──────────────────────────────────────────────
    const contentType = this.readSafeResponseHeader(response.headers, 'content-type') ?? '';
    const normalizedCt = contentType.toLowerCase();
    diagnostic['responseContentType'] = normalizedCt.slice(0, 100) || 'unknown';

    const isJson =
      normalizedCt.includes('application/json') ||
      normalizedCt.includes('application/problem+json');

    if (!isJson) return diagnostic;

    // ── Step 3 & 4: Body analysis (JSON only) ────────────────────────────
    const { body, parseStatus } = this.resolveResponseBody(response.data);
    if (parseStatus !== undefined) {
      diagnostic['providerBodyParseStatus'] = parseStatus;
    }

    // Structural shape: key names only, no values, depth ≤ 2
    Object.assign(diagnostic, this.captureBodyShape(body));

    // Allowlisted field values (string values only, sanitized)
    if (typeof body === 'object' && body !== null && !Array.isArray(body)) {
      this.extractAllowlistedFields(body as Record<string, unknown>, diagnostic);
    }

    return diagnostic;
  }

  /**
   * Reads a single named header from an Axios response headers object.
   *
   * Supports two header representations used by Axios:
   *   - AxiosHeaders (Axios ≥ 1.x): provides case-insensitive .get(name).
   *   - Plain Record<string, string>: falls back to lowercase → original
   *     casing → uppercase key lookups.
   *
   * Handles array-valued headers by returning the first element only.
   * NEVER copies or enumerates the full headers object.
   * ONLY the explicitly requested header name is read.
   */
  private readSafeResponseHeader(
    headers: unknown,
    name: string,
  ): string | undefined {
    if (!headers || typeof headers !== 'object') return undefined;

    // AxiosHeaders (Axios ≥ 1.x) exposes a case-insensitive .get() method.
    const h = headers as Record<string, unknown> & {
      get?: (n: string) => string | string[] | null | undefined | false;
    };
    if (typeof h.get === 'function') {
      const val = h.get(name);
      if (val === null || val === undefined || val === false) return undefined;
      if (Array.isArray(val)) return val[0] != null ? String(val[0]) : undefined;
      return String(val);
    }
    // Plain-object fallback: case-insensitive key search.
    // We iterate ONLY to find the target header name — no keys, values, or
    // headers are enumerated, logged, or persisted.
    const plain = headers as Record<string, unknown>;
    const lcName = name.toLowerCase();
    for (const key of Object.keys(plain)) {
      if (key.toLowerCase() !== lcName) continue;
      const value = plain[key];
      if (value === undefined || value === null) return undefined;
      if (Array.isArray(value)) {
        const first = value[0];
        return first != null ? String(first) : undefined;
      }
      return String(value);
    }
    return undefined;
  }

  /**
   * Sanitizes a response header value for safe persistence.
   *
   * Applied rules (in order):
   *   1. Strip ASCII control characters (< 0x20, 0x7F).
   *   2. Strip XML / HTML tags.
   *   3. Collapse consecutive whitespace to a single space.
   *   4. Trim leading/trailing whitespace.
   *   5. Cap at MAX_HEADER_VALUE_LENGTH (500) characters.
   */
  private sanitizeHeaderValue(value: string, maxLength = 500): string {
    return value
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x1F\x7F]/g, ' ')  // control characters → space
      .replace(/<[^>]+>/g, '[xml]')        // XML / HTML tags
      .replace(/\s+/g, ' ')               // collapse whitespace
      .trim()
      .slice(0, maxLength);
  }

  /**
   * Normalises the raw Axios response data to a JavaScript value we can
   * safely inspect.  Handles the cases where Axios may hand us a string or
   * Buffer instead of a parsed object.
   *
   * NEVER persists the raw string/buffer itself.
   */
  private resolveResponseBody(
    data: unknown,
  ): { body: unknown; parseStatus?: string } {
    // Buffer / Uint8Array must be checked BEFORE the generic object check because
    // Buffer IS an object (typeof Buffer === 'object').  Decode and JSON.parse.
    if (Buffer.isBuffer(data) || data instanceof Uint8Array) {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as Uint8Array);
      if (buf.length > 10_000)
        return { body: buf, parseStatus: 'BUFFER_TOO_LARGE_TO_PARSE' };
      const str = buf.toString('utf8');
      try {
        return { body: JSON.parse(str) as unknown, parseStatus: 'PARSED_FROM_BUFFER' };
      } catch {
        return { body: str, parseStatus: 'BUFFER_PARSE_FAILED' };
      }
    }

    // Already a JS value — Axios parsed the JSON (or it is null/array/plain object)
    if (typeof data === 'object') return { body: data };

    if (typeof data === 'string') {
      if (data.length === 0) return { body: null, parseStatus: 'EMPTY_STRING' };
      if (data.length > 10_000)
        return { body: data, parseStatus: 'STRING_TOO_LARGE_TO_PARSE' };
      try {
        return { body: JSON.parse(data) as unknown, parseStatus: 'PARSED_FROM_STRING' };
      } catch {
        return { body: data, parseStatus: 'STRING_PARSE_FAILED' };
      }
    }

    return { body: data };
  }

  /**
   * Returns only structural metadata about the body — key names, depth ≤ 2.
   * NEVER returns any values.
   */
  private captureBodyShape(
    body: unknown,
  ): Record<string, string | number | boolean | null> {
    const shape: Record<string, string | number | boolean | null> = {};

    if (body === null || body === undefined) {
      shape['providerBodyType'] = 'null';
      return shape;
    }
    if (typeof body === 'string') {
      shape['providerBodyType'] = 'string';
      shape['providerBodyLength'] = body.length;
      return shape;
    }
    if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
      shape['providerBodyType'] = 'buffer';
      shape['providerBodyLength'] = (body as Buffer).length;
      return shape;
    }
    if (Array.isArray(body)) {
      shape['providerBodyType'] = 'array';
      shape['providerBodyLength'] = body.length;
      if (
        body.length > 0 &&
        typeof body[0] === 'object' &&
        body[0] !== null &&
        !Array.isArray(body[0])
      ) {
        const firstKeys = Object.keys(body[0] as object)
          .slice(0, 15)
          .map((k) => this.sanitizeKeyName(k))
          .join(', ');
        if (firstKeys) shape['providerBodyFirstElementKeys'] = firstKeys;
      }
      return shape;
    }
    if (typeof body === 'object') {
      const obj = body as Record<string, unknown>;
      const rawKeys = Object.keys(obj);
      shape['providerBodyType'] = 'object';
      shape['providerBodyKeys'] = rawKeys
        .slice(0, 20)
        .map((k) => this.sanitizeKeyName(k))
        .join(', ');

      // Depth-2 shape: for each top-level key whose value is an object or
      // array-of-objects, capture the nested key names only.
      const nestedShapes: Record<string, string> = {};
      for (const key of rawKeys.slice(0, 10)) {
        const val = obj[key];
        if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
          const nested = Object.keys(val as object)
            .slice(0, 10)
            .map((k) => this.sanitizeKeyName(k))
            .join(', ');
          if (nested) nestedShapes[this.sanitizeKeyName(key)] = nested;
        } else if (
          Array.isArray(val) &&
          val.length > 0 &&
          typeof val[0] === 'object' &&
          val[0] !== null &&
          !Array.isArray(val[0])
        ) {
          const nested = Object.keys(val[0] as object)
            .slice(0, 10)
            .map((k) => this.sanitizeKeyName(k))
            .join(', ');
          if (nested) nestedShapes[`${this.sanitizeKeyName(key)}[]`] = nested;
        }
      }
      if (Object.keys(nestedShapes).length > 0) {
        shape['providerBodyShape'] = JSON.stringify(nestedShapes).slice(0, 500);
      }
      return shape;
    }

    shape['providerBodyType'] = typeof body;
    return shape;
  }

  /**
   * Sanitises a raw key name for safe use as a diagnostic field key.
   * Allows only alphanumerics, underscore, hyphen, and dot; truncates to 50.
   */
  private sanitizeKeyName(key: string): string {
    return key.replace(/[^a-zA-Z0-9_\-.]/g, '_').slice(0, 50);
  }

  /**
   * Reads explicitly allowlisted field names from a parsed JSON object.
   * Only string values are extracted; all are sanitized before use.
   * This list is intentionally conservative — add entries only after
   * verifying the field name from real Hacienda responses.
   */
  private extractAllowlistedFields(
    body: Record<string, unknown>,
    diagnostic: Record<string, string | number | boolean | null>,
  ): void {
    // RFC 7807 Problem Details (English)
    if (typeof body['detail'] === 'string') {
      diagnostic['haciendaDetail'] = this.sanitizeProviderString(body['detail']);
    }
    if (typeof body['title'] === 'string') {
      diagnostic['haciendaTitle'] = this.sanitizeProviderString(body['title'], 100);
    }
    if (typeof body['message'] === 'string') {
      diagnostic['haciendaMessage'] = this.sanitizeProviderString(body['message']);
    }
    if (Array.isArray(body['errorCodes'])) {
      const safe = (body['errorCodes'] as unknown[])
        .slice(0, 5)
        .filter(
          (c): c is string =>
            typeof c === 'string' && /^[A-Z0-9_\-]{1,50}$/.test(c),
        )
        .join(', ');
      if (safe) diagnostic['haciendaErrorCodes'] = safe;
    }
    if (Array.isArray(body['errors']) && body['errors'].length > 0) {
      const first = body['errors'][0] as Record<string, unknown>;
      if (typeof first?.['message'] === 'string') {
        diagnostic['haciendaFirstErrorMessage'] = this.sanitizeProviderString(
          first['message'] as string,
        );
      }
      if (
        typeof first?.['code'] === 'string' &&
        /^[A-Z0-9_\-]{1,50}$/.test(first['code'])
      ) {
        diagnostic['haciendaFirstErrorCode'] = first['code'] as string;
      }
    }
    // NOTE: When providerBodyKeys reveals real Hacienda field names, add
    // the verified safe fields here with their Spanish/custom names.
  }

  /**
   * Sanitizes a Hacienda provider string for safe inclusion in diagnostics.
   * Removes XML-like content and caps length.
   */
  private sanitizeProviderString(value: string, maxLength = 300): string {
    return value
      .replace(/<[^>]+>/g, '[xml]') // strip XML tags
      .replace(/\s+/g, ' ')         // collapse whitespace
      .trim()
      .slice(0, maxLength);
  }

  /**
   * Extracts safe allowlisted headers from a 2xx response for diagnostic purposes.
   * Used only for undocumented 2xx (e.g. HTTP 202).
   * NEVER captures authorization, cookies, tokens, or the full headers object.
   */
  private extractSafeSuccessHeaders(
    response: Pick<AxiosResponse, 'headers'>,
  ): Record<string, string> {
    const out: Record<string, string> = {};
    const loc = this.readSafeResponseHeader(response.headers, 'location');
    if (loc) out['haciendaLocation'] = this.sanitizeHeaderValue(loc, 200);
    const cause = this.readSafeResponseHeader(response.headers, 'x-error-cause');
    if (cause) out['haciendaErrorCause'] = this.sanitizeHeaderValue(cause);
    const ve = this.readSafeResponseHeader(response.headers, 'validation-exception');
    if (ve) out['haciendaValidationException'] = this.sanitizeHeaderValue(ve);
    return out;
  }

  private nonRetryable(httpStatus: number, normalizedErrorCode: string): HaciendaSubmissionResult {
    return {
      kind: 'NON_RETRYABLE_FAILURE',
      nextStatus: 'MANUAL_REVIEW_REQUIRED',
      httpStatus,
      normalizedErrorCode,
      sanitizedErrorMessage: 'Hacienda request failed with a non-retryable provider response.',
    };
  }

  private extractRateLimit(
    response: Pick<AxiosResponse, 'headers'>,
  ): HaciendaRateLimitMetadata | undefined {
    const headers = response.headers as Record<string, string | number | undefined>;
    const limit = this.headerValue({ headers }, 'x-ratelimit-limit');
    const remaining = this.headerValue({ headers }, 'x-ratelimit-remaining');
    const reset = this.headerValue({ headers }, 'x-ratelimit-reset');
    const retryAfter = this.headerValue({ headers }, 'retry-after');

    if (!limit && !remaining && !reset && !retryAfter) {
      return undefined;
    }

    return {
      limit,
      remaining,
      reset,
      retryAfterSeconds: retryAfter ? Number(retryAfter) : undefined,
    };
  }

  private headerValue(response: Pick<AxiosResponse, 'headers'>, name: string): string | undefined {
    const headers = response.headers as Record<string, string | number | undefined>;
    const value = headers[name] ?? headers[name.toLowerCase()];
    return value === undefined ? undefined : String(value);
  }
}
