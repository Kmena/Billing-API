import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosError, AxiosResponse } from 'axios';
import { firstValueFrom } from 'rxjs';
import type { HaciendaSubmissionConfig } from '../../../../infrastructure/config/hacienda-submission.config';
import type { HaciendaEnvironment } from '../../domain/fiscal.constants';
import type {
  HaciendaQueryStatusInput,
  HaciendaRateLimitMetadata,
  HaciendaSubmissionPort,
  HaciendaSubmissionResult,
  HaciendaSubmitSignedDocumentInput,
} from '../../application/submission/ports/hacienda-submission.port';

interface HaciendaIdentificationRequest {
  readonly tipo: string;
  readonly numero: string;
}

interface HaciendaPartyRequest {
  readonly tipoIdentificacion: HaciendaIdentificationRequest;
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
      return {
        ...base,
        kind: 'ACCEPTED',
        nextStatus: 'ACCEPTED',
        responseArtifact: this.decodeResponseArtifact(response.data['respuesta-xml']),
      };
    }

    if (providerStatus === 'rechazado') {
      return {
        ...base,
        kind: 'REJECTED',
        nextStatus: 'REJECTED',
        responseArtifact: this.decodeResponseArtifact(response.data['respuesta-xml']),
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

  private mapParty(party: HaciendaSubmitSignedDocumentInput['issuer']): HaciendaPartyRequest {
    return {
      tipoIdentificacion: {
        tipo: party.identification.type,
        numero: party.identification.number,
      },
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
      return this.retryable(status, 'HACIENDA_TOKEN_EXPIRED');
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
      return this.nonRetryable(status, 'HACIENDA_NON_RETRYABLE_ERROR');
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
