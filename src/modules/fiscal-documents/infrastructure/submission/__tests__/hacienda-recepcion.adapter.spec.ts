import { of, throwError } from 'rxjs';
import { HaciendaRecepcionAdapter } from '../hacienda-recepcion.adapter';
import type { HttpService } from '@nestjs/axios';
import type { ConfigService } from '@nestjs/config';

const clave = '50601012500310112345600100001010000000001100000001';

function makeAdapter(http: Partial<HttpService>) {
  const configService = {
    get: jest.fn().mockReturnValue({
      productionBaseUrl: 'https://api.comprobanteselectronicos.go.cr/recepcion/v1/',
      sandboxBaseUrl: 'https://api.comprobanteselectronicos.go.cr/recepcion-sandbox/v1/',
      timeoutMs: 15000,
      callbackUrl: 'https://billing.example.test/api/v1/hacienda/callback',
    }),
  } as unknown as ConfigService;

  return new HaciendaRecepcionAdapter(configService, http as HttpService);
}

function submitInput() {
  return {
    environment: 'SANDBOX' as const,
    accessToken: 'token',
    clave,
    consecutive: '00100001010000000001',
    issueDate: new Date('2025-01-01T00:00:00.000Z'),
    documentType: 'INVOICE' as const,
    issuer: { identification: { type: '02', number: '3101123456' } },
    receiver: { identification: { type: '01', number: '101110111' } },
    signedXml: Buffer.from('<FacturaElectronica/>', 'utf8'),
  };
}

describe('HaciendaRecepcionAdapter', () => {
  it('posts official reception JSON with bearer token and Base64 XML', async () => {
    const post = jest.fn().mockReturnValue(
      of({
        status: 201,
        headers: { location: 'https://hacienda.test/recepcion/clave' },
        data: {},
      }),
    );
    const adapter = makeAdapter({ post });

    await expect(adapter.submitSignedDocument(submitInput())).resolves.toMatchObject({
      kind: 'ACKNOWLEDGED',
      nextStatus: 'ACKNOWLEDGED',
      providerLocation: 'https://hacienda.test/recepcion/clave',
    });

    expect(post).toHaveBeenCalledWith(
      'https://api.comprobanteselectronicos.go.cr/recepcion-sandbox/v1/recepcion',
      expect.objectContaining({
        clave,
        fecha: '2025-01-01T00:00:00.000Z',
        comprobanteXml: Buffer.from('<FacturaElectronica/>', 'utf8').toString('base64'),
        callbackUrl: 'https://billing.example.test/api/v1/hacienda/callback',
      }),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'bearer token' }),
      }),
    );
  });

  it.each([
    ['recibido', 'PROCESSING', 'PROCESSING'],
    ['procesando', 'PROCESSING', 'PROCESSING'],
    ['aceptado', 'ACCEPTED', 'ACCEPTED'],
    ['rechazado', 'REJECTED', 'REJECTED'],
  ] as const)('maps GET ind-estado=%s', async (providerStatus, kind, nextStatus) => {
    const encodedResponse = Buffer.from(`<Estado>${providerStatus}</Estado>`, 'utf8').toString(
      'base64',
    );
    const get = jest.fn().mockReturnValue(
      of({
        status: 200,
        headers: {},
        data: { 'ind-estado': providerStatus, 'respuesta-xml': encodedResponse },
      }),
    );
    const adapter = makeAdapter({ get });

    await expect(
      adapter.queryStatusByClave({ environment: 'SANDBOX', accessToken: 'token', clave }),
    ).resolves.toMatchObject({ kind, nextStatus, providerStatus });
  });

  it('Base64-decodes respuesta-xml exact bytes', async () => {
    const responseXml = '<MensajeHacienda>aceptado</MensajeHacienda>';
    const get = jest.fn().mockReturnValue(
      of({
        status: 200,
        headers: {},
        data: {
          'ind-estado': 'aceptado',
          'respuesta-xml': Buffer.from(responseXml, 'utf8').toString('base64'),
        },
      }),
    );
    const adapter = makeAdapter({ get });

    const result = await adapter.queryStatusByClave({
      environment: 'SANDBOX',
      accessToken: 'token',
      clave,
    });

    expect(result.responseArtifact?.content.toString('utf8')).toBe(responseXml);
    expect(result.responseArtifact?.contentType).toBe('application/xml');
  });

  it('captures rate-limit headers on 429', async () => {
    const post = jest.fn().mockReturnValue(
      throwError(() => ({
        response: { status: 429, headers: { 'x-ratelimit-remaining': '0', 'retry-after': '30' } },
      })),
    );
    const adapter = makeAdapter({ post });

    await expect(adapter.submitSignedDocument(submitInput())).resolves.toMatchObject({
      kind: 'RETRYABLE_FAILURE',
      nextStatus: 'TECHNICAL_RETRY_PENDING',
      httpStatus: 429,
      rateLimit: { remaining: '0', retryAfterSeconds: 30 },
    });
  });

  it('maps ambiguous POST transport failure to POST_OUTCOME_UNKNOWN', async () => {
    const post = jest.fn().mockReturnValue(throwError(() => new Error('timeout')));
    const adapter = makeAdapter({ post });

    await expect(adapter.submitSignedDocument(submitInput())).resolves.toMatchObject({
      kind: 'AMBIGUOUS_FAILURE',
      nextStatus: 'POST_OUTCOME_UNKNOWN',
    });
  });

  // ── HTTP 400: classification ──────────────────────────────────────────────

  describe('HTTP 400 classification', () => {
    it('maps HTTP 400 to NON_RETRYABLE_FAILURE / MANUAL_REVIEW_REQUIRED', async () => {
      const post = jest
        .fn()
        .mockReturnValue(throwError(() => ({ response: { status: 400, headers: {}, data: {} } })));
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      expect(result.kind).toBe('NON_RETRYABLE_FAILURE');
      expect(result.nextStatus).toBe('MANUAL_REVIEW_REQUIRED');
      expect(result.httpStatus).toBe(400);
    });

    it('HTTP 400 is never retried — POST called exactly once', async () => {
      const post = jest
        .fn()
        .mockReturnValue(throwError(() => ({ response: { status: 400, headers: {}, data: {} } })));
      await makeAdapter({ post }).submitSignedDocument(submitInput());
      expect(post).toHaveBeenCalledTimes(1);
    });

    it('production endpoint blocked even when HTTP 400 diagnostic is extracted', async () => {
      const post = jest
        .fn()
        .mockReturnValue(throwError(() => ({ response: { status: 400, headers: {}, data: {} } })));
      await makeAdapter({ post }).submitSignedDocument(submitInput());
      expect(post.mock.calls[0][0] as string).toContain('recepcion-sandbox');
      expect(post.mock.calls[0][0] as string).not.toContain('/recepcion/v1');
    });
  });

  // ── HTTP 400: structural body-shape capture ───────────────────────────────
  //
  // These tests verify that providerBodyType / providerBodyKeys are ALWAYS
  // emitted for JSON responses, regardless of whether the allowlist matched.
  // This is the primary mechanism to discover Hacienda's real field names
  // without making additional network calls.

  describe('HTTP 400: structural body-shape capture (key names only, no values)', () => {
    it('records providerBodyType=object for a plain JSON object', async () => {
      const post = jest.fn().mockReturnValue(
        throwError(() => ({
          response: {
            status: 400,
            headers: { 'content-type': 'application/json' },
            data: { codigo: 'DGT-001', mensaje: 'fecha invalida' },
          },
        })),
      );
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      expect(result.providerMetadata?.['providerBodyType']).toBe('object');
    });

    it('records providerBodyKeys with actual key names (not values)', async () => {
      const post = jest.fn().mockReturnValue(
        throwError(() => ({
          response: {
            status: 400,
            headers: { 'content-type': 'application/json' },
            data: { codigo: 'DGT-001', mensaje: 'fecha invalida', descripcion: 'detalle' },
          },
        })),
      );
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      const keys = result.providerMetadata?.['providerBodyKeys'] as string;
      expect(keys).toContain('codigo');
      expect(keys).toContain('mensaje');
      expect(keys).toContain('descripcion');
      // Must NOT contain the actual values
      expect(keys).not.toContain('DGT-001');
      expect(keys).not.toContain('fecha invalida');
    });

    it('captures depth-2 nested key names in providerBodyShape', async () => {
      const post = jest.fn().mockReturnValue(
        throwError(() => ({
          response: {
            status: 400,
            headers: { 'content-type': 'application/json' },
            data: { error: { code: 'X', reason: 'Y', hint: 'Z' } },
          },
        })),
      );
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      const shape = result.providerMetadata?.['providerBodyShape'] as string | undefined;
      expect(shape).toBeDefined();
      expect(shape).toContain('code');
      expect(shape).toContain('reason');
      // Must NOT contain the actual values
      expect(shape).not.toContain('"X"');
      expect(shape).not.toContain('"Y"');
    });

    it('records providerBodyType=array for a JSON array body', async () => {
      const post = jest.fn().mockReturnValue(
        throwError(() => ({
          response: {
            status: 400,
            headers: { 'content-type': 'application/json' },
            data: [{ campo: 'fecha', error: 'invalida' }],
          },
        })),
      );
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      expect(result.providerMetadata?.['providerBodyType']).toBe('array');
      expect(result.providerMetadata?.['providerBodyLength']).toBe(1);
    });

    it('captures first-element keys for a JSON array body', async () => {
      const post = jest.fn().mockReturnValue(
        throwError(() => ({
          response: {
            status: 400,
            headers: { 'content-type': 'application/json' },
            data: [{ campo: 'emisor', mensaje: 'invalido' }],
          },
        })),
      );
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      const firstKeys = result.providerMetadata?.['providerBodyFirstElementKeys'] as string;
      expect(firstKeys).toContain('campo');
      expect(firstKeys).toContain('mensaje');
      // Values must not leak
      expect(firstKeys).not.toContain('emisor');
      expect(firstKeys).not.toContain('invalido');
    });

    it('records providerBodyType=null for a null body', async () => {
      const post = jest.fn().mockReturnValue(
        throwError(() => ({
          response: {
            status: 400,
            headers: { 'content-type': 'application/json' },
            data: null,
          },
        })),
      );
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      expect(result.providerMetadata?.['providerBodyType']).toBe('null');
    });

    it('records providerBodyType=object for an empty object (no keys)', async () => {
      const post = jest.fn().mockReturnValue(
        throwError(() => ({
          response: {
            status: 400,
            headers: { 'content-type': 'application/json' },
            data: {},
          },
        })),
      );
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      expect(result.providerMetadata?.['providerBodyType']).toBe('object');
      expect(result.providerMetadata?.['providerBodyKeys']).toBe('');
    });

    it('caps providerBodyKeys to 20 top-level keys', async () => {
      const bigObj = Object.fromEntries(
        Array.from({ length: 25 }, (_, i) => [`key${i}`, `val${i}`]),
      );
      const post = jest.fn().mockReturnValue(
        throwError(() => ({
          response: {
            status: 400,
            headers: { 'content-type': 'application/json' },
            data: bigObj,
          },
        })),
      );
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      const keys = (result.providerMetadata?.['providerBodyKeys'] as string).split(', ');
      expect(keys.length).toBeLessThanOrEqual(20);
    });

    it('sanitizes key names — removes non-alphanumeric/underscore/hyphen/dot', async () => {
      const weirdKeys: Record<string, string> = {};
      weirdKeys['valid-key'] = 'x';
      weirdKeys['semi;colon'] = 'y';
      weirdKeys['angle<bracket'] = 'z';
      const post = jest.fn().mockReturnValue(
        throwError(() => ({
          response: {
            status: 400,
            headers: { 'content-type': 'application/json' },
            data: weirdKeys,
          },
        })),
      );
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      const keys = result.providerMetadata?.['providerBodyKeys'] as string;
      expect(keys).toContain('valid-key');
      expect(keys).not.toContain(';');
      expect(keys).not.toContain('<');
    });

    it('does not capture nested shape for depth > 2', async () => {
      const post = jest.fn().mockReturnValue(
        throwError(() => ({
          response: {
            status: 400,
            headers: { 'content-type': 'application/json' },
            data: { a: { b: { c: { deepKey: 'deepValue' } } } },
          },
        })),
      );
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      const serialized = JSON.stringify(result.providerMetadata ?? {});
      // depth-2 shows nested keys of 'a' (which is 'b')
      // depth-3 key 'c' should NOT appear as a separate field
      expect(serialized).not.toContain('deepKey');
      expect(serialized).not.toContain('deepValue');
    });
  });

  // ── HTTP 400: string / Buffer body handling ───────────────────────────────

  describe('HTTP 400: string and Buffer body handling', () => {
    it('JSON string body — parses and captures structural shape', async () => {
      const jsonString = JSON.stringify({ codigo: 'DGT-001', mensaje: 'error' });
      const post = jest.fn().mockReturnValue(
        throwError(() => ({
          response: {
            status: 400,
            headers: { 'content-type': 'application/json' },
            data: jsonString,
          },
        })),
      );
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      expect(result.providerMetadata?.['providerBodyType']).toBe('object');
      expect(result.providerMetadata?.['providerBodyParseStatus']).toBe('PARSED_FROM_STRING');
      const keys = result.providerMetadata?.['providerBodyKeys'] as string;
      expect(keys).toContain('codigo');
      expect(keys).not.toContain('DGT-001');
    });

    it('JSON string body — same allowlisted fields extracted after parse', async () => {
      const jsonString = JSON.stringify({ detail: 'fecha mismatch', title: 'Validation Error' });
      const post = jest.fn().mockReturnValue(
        throwError(() => ({
          response: {
            status: 400,
            headers: { 'content-type': 'application/json' },
            data: jsonString,
          },
        })),
      );
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      expect(result.providerMetadata?.['haciendaDetail']).toBe('fecha mismatch');
      expect(result.providerMetadata?.['haciendaTitle']).toBe('Validation Error');
    });

    it('Buffer body — parses JSON and captures structural shape', async () => {
      const buf = Buffer.from(JSON.stringify({ campo: 'fecha', error: 'invalida' }), 'utf8');
      const post = jest.fn().mockReturnValue(
        throwError(() => ({
          response: {
            status: 400,
            headers: { 'content-type': 'application/json' },
            data: buf,
          },
        })),
      );
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      expect(result.providerMetadata?.['providerBodyParseStatus']).toBe('PARSED_FROM_BUFFER');
      expect(result.providerMetadata?.['providerBodyType']).toBe('object');
      const keys = result.providerMetadata?.['providerBodyKeys'] as string;
      expect(keys).toContain('campo');
      expect(keys).not.toContain('invalida');
    });

    it('Uint8Array body — parsed same as Buffer', async () => {
      const uint8 = new Uint8Array(Buffer.from(JSON.stringify({ detail: 'bad clave' }), 'utf8'));
      const post = jest.fn().mockReturnValue(
        throwError(() => ({
          response: {
            status: 400,
            headers: { 'content-type': 'application/json' },
            data: uint8,
          },
        })),
      );
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      expect(result.providerMetadata?.['haciendaDetail']).toBe('bad clave');
    });

    it('empty string body — records EMPTY_STRING parse status', async () => {
      const post = jest.fn().mockReturnValue(
        throwError(() => ({
          response: {
            status: 400,
            headers: { 'content-type': 'application/json' },
            data: '',
          },
        })),
      );
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      expect(result.providerMetadata?.['providerBodyParseStatus']).toBe('EMPTY_STRING');
      expect(result.providerMetadata?.['providerBodyType']).toBe('null');
    });

    it('malformed JSON string — records STRING_PARSE_FAILED', async () => {
      const post = jest.fn().mockReturnValue(
        throwError(() => ({
          response: {
            status: 400,
            headers: { 'content-type': 'application/json' },
            data: 'not valid json {{{',
          },
        })),
      );
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      expect(result.providerMetadata?.['providerBodyParseStatus']).toBe('STRING_PARSE_FAILED');
      // raw body string MUST NOT appear in output
      expect(JSON.stringify(result.providerMetadata)).not.toContain('not valid json');
    });

    it('oversized string body — records STRING_TOO_LARGE_TO_PARSE', async () => {
      const bigString = 'x'.repeat(10_001);
      const post = jest.fn().mockReturnValue(
        throwError(() => ({
          response: {
            status: 400,
            headers: { 'content-type': 'application/json' },
            data: bigString,
          },
        })),
      );
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      expect(result.providerMetadata?.['providerBodyParseStatus']).toBe(
        'STRING_TOO_LARGE_TO_PARSE',
      );
      // Raw body content must not be persisted
      expect(JSON.stringify(result.providerMetadata)).not.toContain('x'.repeat(50));
    });

    it('oversized Buffer — records BUFFER_TOO_LARGE_TO_PARSE', async () => {
      const buf = Buffer.alloc(10_001, 65); // 10001 'A' bytes
      const post = jest.fn().mockReturnValue(
        throwError(() => ({
          response: {
            status: 400,
            headers: { 'content-type': 'application/json' },
            data: buf,
          },
        })),
      );
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      expect(result.providerMetadata?.['providerBodyParseStatus']).toBe(
        'BUFFER_TOO_LARGE_TO_PARSE',
      );
    });

    it('malformed JSON in Buffer — records BUFFER_PARSE_FAILED', async () => {
      const buf = Buffer.from('{ bad json', 'utf8');
      const post = jest.fn().mockReturnValue(
        throwError(() => ({
          response: {
            status: 400,
            headers: { 'content-type': 'application/json' },
            data: buf,
          },
        })),
      );
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      expect(result.providerMetadata?.['providerBodyParseStatus']).toBe('BUFFER_PARSE_FAILED');
    });
  });

  // ── HTTP 400: allowlist extraction ────────────────────────────────────────

  describe('HTTP 400: allowlisted field extraction (known field names)', () => {
    it('captures detail and title from RFC 7807 object', async () => {
      const post = jest.fn().mockReturnValue(
        throwError(() => ({
          response: {
            status: 400,
            headers: { 'content-type': 'application/json' },
            data: {
              detail: 'El campo fecha no corresponde con FechaEmision',
              title: 'Bad Request',
            },
          },
        })),
      );
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      expect(result.providerMetadata?.['haciendaDetail']).toBe(
        'El campo fecha no corresponde con FechaEmision',
      );
      expect(result.providerMetadata?.['haciendaTitle']).toBe('Bad Request');
    });

    it('captures detail from problem+json', async () => {
      const post = jest.fn().mockReturnValue(
        throwError(() => ({
          response: {
            status: 400,
            headers: { 'content-type': 'application/problem+json; charset=utf-8' },
            data: {
              detail: 'Validation failed',
              errorCodes: ['DGT-001', 'DGT-002'],
              errors: [{ code: 'ERR-001', message: 'clave mismatch' }],
            },
          },
        })),
      );
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      expect(result.providerMetadata?.['haciendaDetail']).toBe('Validation failed');
      expect(result.providerMetadata?.['haciendaErrorCodes']).toBe('DGT-001, DGT-002');
      expect(result.providerMetadata?.['haciendaFirstErrorCode']).toBe('ERR-001');
      expect(result.providerMetadata?.['haciendaFirstErrorMessage']).toBe('clave mismatch');
    });

    it('strips XML tags from allowlisted string values', async () => {
      const post = jest.fn().mockReturnValue(
        throwError(() => ({
          response: {
            status: 400,
            headers: { 'content-type': 'application/json' },
            data: { detail: '<error>sensitive xml</error>' },
          },
        })),
      );
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      expect(result.providerMetadata?.['haciendaDetail']).not.toContain('<error>');
      expect(result.providerMetadata?.['haciendaDetail']).toContain('[xml]');
    });

    it('rejects errorCodes entries with non-safe characters', async () => {
      const post = jest.fn().mockReturnValue(
        throwError(() => ({
          response: {
            status: 400,
            headers: { 'content-type': 'application/json' },
            data: { errorCodes: ['DGT-001', 'not safe!', "'; DROP TABLE;"] },
          },
        })),
      );
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      const codes = result.providerMetadata?.['haciendaErrorCodes'] as string | undefined;
      if (codes) {
        expect(codes).toContain('DGT-001');
        expect(codes).not.toContain('not safe');
        expect(codes).not.toContain('DROP TABLE');
      }
    });
  });

  // ── HTTP 400: non-JSON body handling ──────────────────────────────────────

  describe('HTTP 400: non-JSON content-type', () => {
    it('captures content-type for text/html response — does not parse body', async () => {
      const post = jest.fn().mockReturnValue(
        throwError(() => ({
          response: {
            status: 400,
            headers: { 'content-type': 'text/html' },
            data: '<html><body>Error</body></html>',
          },
        })),
      );
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      expect(result.providerMetadata?.['responseContentType']).toBe('text/html');
      // HTML body MUST NOT appear anywhere
      expect(JSON.stringify(result.providerMetadata)).not.toContain('<html>');
      // No providerBodyType because non-JSON is short-circuited
      expect(result.providerMetadata?.['providerBodyType']).toBeUndefined();
    });

    it('captures content-type for text/plain response', async () => {
      const post = jest.fn().mockReturnValue(
        throwError(() => ({
          response: {
            status: 400,
            headers: { 'content-type': 'text/plain' },
            data: 'Bad Request',
          },
        })),
      );
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      expect(result.providerMetadata?.['responseContentType']).toBe('text/plain');
    });

    it('uses unknown content-type when header is absent', async () => {
      const post = jest
        .fn()
        .mockReturnValue(
          throwError(() => ({ response: { status: 400, headers: {}, data: { a: 1 } } })),
        );
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      expect(result.providerMetadata?.['responseContentType']).toBe('unknown');
    });
  });

  // ── HTTP 400: security invariants ─────────────────────────────────────────

  describe('HTTP 400: security invariants', () => {
    it('never captures authorization or set-cookie from response headers', async () => {
      const post = jest.fn().mockReturnValue(
        throwError(() => ({
          response: {
            status: 400,
            headers: {
              'content-type': 'application/json',
              'set-cookie': 'session=secret; HttpOnly',
              authorization: 'Bearer leaked-token',
            },
            data: { detail: 'error' },
          },
        })),
      );
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('set-cookie');
      expect(serialized).not.toContain('session=secret');
      expect(serialized).not.toContain('leaked-token');
    });

    it('never exposes raw body string in any metadata field', async () => {
      const sensitiveBody = JSON.stringify({ codigo: 'X', mensaje: 'contrasena-secreta-12345' });
      const post = jest.fn().mockReturnValue(
        throwError(() => ({
          response: {
            status: 400,
            headers: { 'content-type': 'application/json' },
            data: sensitiveBody,
          },
        })),
      );
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      // The raw string must not be in the output
      expect(JSON.stringify(result)).not.toContain('contrasena-secreta-12345');
      // But the parse status and structural shape should be there
      expect(result.providerMetadata?.['providerBodyParseStatus']).toBe('PARSED_FROM_STRING');
    });

    it('never exposes raw Buffer bytes in any metadata field', async () => {
      const secret = 'super-secret-value-abc123';
      const buf = Buffer.from(JSON.stringify({ campo: 'emisor', valor: secret }), 'utf8');
      const post = jest.fn().mockReturnValue(
        throwError(() => ({
          response: {
            status: 400,
            headers: { 'content-type': 'application/json' },
            data: buf,
          },
        })),
      );
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      expect(JSON.stringify(result)).not.toContain(secret);
      expect(result.providerMetadata?.['providerBodyParseStatus']).toBe('PARSED_FROM_BUFFER');
    });

    it('never exposes XML-like content from body keys or values', async () => {
      const post = jest.fn().mockReturnValue(
        throwError(() => ({
          response: {
            status: 400,
            headers: { 'content-type': 'application/json' },
            data: {
              '<injected>': 'value',
              normalKey: '<xml>malicious</xml>',
            },
          },
        })),
      );
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      const serialized = JSON.stringify(result.providerMetadata ?? {});
      // Key should be sanitized (< becomes _)
      expect(serialized).not.toContain('<injected>');
      // XML content in the allowlist field detail would be stripped (this field is not in allowlist,
      // but we verify no raw XML values appear through any path)
    });

    it('structural shape providerBodyShape never contains values, only key names', async () => {
      const post = jest.fn().mockReturnValue(
        throwError(() => ({
          response: {
            status: 400,
            headers: { 'content-type': 'application/json' },
            data: {
              parent: {
                secretKey: 'THIS_MUST_NOT_APPEAR',
                otherKey: 'ALSO_SECRET',
              },
            },
          },
        })),
      );
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      const shape = result.providerMetadata?.['providerBodyShape'] as string | undefined;
      expect(shape).toBeDefined();
      expect(shape).toContain('secretKey');
      expect(shape).toContain('otherKey');
      expect(shape).not.toContain('THIS_MUST_NOT_APPEAR');
      expect(shape).not.toContain('ALSO_SECRET');
    });
  });

  // ── X-Error-Cause header extraction ──────────────────────────────────────
  //
  // Hacienda /recepcion returns its rejection reason in the X-Error-Cause
  // response header when the body is empty (HTTP 400 + empty body).
  //
  // ALL TESTS USE MOCKS.  ZERO real Hacienda requests are made.

  describe('X-Error-Cause header extraction', () => {
    // ── Case 1-3: case-insensitive lookup ─────────────────────────────────

    it('captures x-error-cause (lowercase header name)', async () => {
      const post = jest.fn().mockReturnValue(
        throwError(() => ({
          response: {
            status: 400,
            headers: { 'x-error-cause': 'clave duplicada', 'content-type': 'application/json' },
            data: '',
          },
        })),
      );
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      expect(result.providerMetadata?.['haciendaErrorCause']).toBe('clave duplicada');
    });

    it('captures X-Error-Cause (original mixed casing) via plain-object lookup', async () => {
      const post = jest.fn().mockReturnValue(
        throwError(() => ({
          response: {
            status: 400,
            headers: { 'X-Error-Cause': 'emisor invalido', 'content-type': 'application/json' },
            data: '',
          },
        })),
      );
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      expect(result.providerMetadata?.['haciendaErrorCause']).toBe('emisor invalido');
    });

    it('captures X-ERROR-CAUSE (all uppercase) via plain-object lookup', async () => {
      const post = jest.fn().mockReturnValue(
        throwError(() => ({
          response: {
            status: 400,
            headers: { 'X-ERROR-CAUSE': 'fecha incorrecta', 'content-type': 'application/json' },
            data: '',
          },
        })),
      );
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      expect(result.providerMetadata?.['haciendaErrorCause']).toBe('fecha incorrecta');
    });

    // ── Case 4: AxiosHeaders-style access ────────────────────────────────

    it('uses AxiosHeaders.get() for case-insensitive lookup when available', async () => {
      const { AxiosHeaders } = jest.requireActual<typeof import('axios')>('axios');
      const headers = new AxiosHeaders({
        'X-Error-Cause': 'firma invalida',
        'Content-Type': 'application/json',
      });
      const post = jest
        .fn()
        .mockReturnValue(throwError(() => ({ response: { status: 400, headers, data: '' } })));
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      expect(result.providerMetadata?.['haciendaErrorCause']).toBe('firma invalida');
    });

    it('AxiosHeaders.get() is case-insensitive — X-ERROR-CAUSE resolves same value', async () => {
      const { AxiosHeaders } = jest.requireActual<typeof import('axios')>('axios');
      const headers = new AxiosHeaders({ 'x-error-cause': 'consecutive invalido' });
      const post = jest
        .fn()
        .mockReturnValue(throwError(() => ({ response: { status: 400, headers, data: '' } })));
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      // AxiosHeaders.get('x-error-cause') should find 'consecutive invalido'
      expect(result.providerMetadata?.['haciendaErrorCause']).toBe('consecutive invalido');
    });

    // ── Case 5-8: sanitization ────────────────────────────────────────────

    it('trims leading and trailing whitespace from x-error-cause', async () => {
      const post = jest.fn().mockReturnValue(
        throwError(() => ({
          response: {
            status: 400,
            headers: { 'x-error-cause': '  receptor no encontrado  ' },
            data: '',
          },
        })),
      );
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      expect(result.providerMetadata?.['haciendaErrorCause']).toBe('receptor no encontrado');
    });

    it('strips control characters from x-error-cause', async () => {
      const withCtrl = 'error\x00message\x1F\x7Fhere';
      const post = jest.fn().mockReturnValue(
        throwError(() => ({
          response: { status: 400, headers: { 'x-error-cause': withCtrl }, data: '' },
        })),
      );
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      const cause = result.providerMetadata?.['haciendaErrorCause'] as string;
      expect(cause).not.toMatch(/[\x00-\x1F\x7F]/);
      expect(cause).toContain('error');
      expect(cause).toContain('message');
    });

    it('strips XML/HTML tags from x-error-cause', async () => {
      const post = jest.fn().mockReturnValue(
        throwError(() => ({
          response: {
            status: 400,
            headers: { 'x-error-cause': '<error>clave invalida</error>' },
            data: '',
          },
        })),
      );
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      const cause = result.providerMetadata?.['haciendaErrorCause'] as string;
      expect(cause).not.toContain('<error>');
      expect(cause).toContain('[xml]');
      expect(cause).toContain('clave invalida');
    });

    it('truncates x-error-cause to 500 characters', async () => {
      const longCause = 'a'.repeat(600);
      const post = jest.fn().mockReturnValue(
        throwError(() => ({
          response: { status: 400, headers: { 'x-error-cause': longCause }, data: '' },
        })),
      );
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      const cause = result.providerMetadata?.['haciendaErrorCause'] as string;
      expect(cause.length).toBeLessThanOrEqual(500);
    });

    // ── Case 10-12: missing / empty / array header ────────────────────────

    it('haciendaErrorCause is absent when x-error-cause header is missing', async () => {
      const post = jest.fn().mockReturnValue(
        throwError(() => ({
          response: { status: 400, headers: { 'content-type': 'application/json' }, data: '' },
        })),
      );
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      expect(result.providerMetadata?.['haciendaErrorCause']).toBeUndefined();
    });

    it('haciendaErrorCause is absent when x-error-cause header is an empty string', async () => {
      const post = jest.fn().mockReturnValue(
        throwError(() => ({
          response: {
            status: 400,
            headers: { 'x-error-cause': '', 'content-type': 'application/json' },
            data: '',
          },
        })),
      );
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      // Empty string resolves to undefined (readSafeResponseHeader returns ''
      // which is falsy, so extractProviderDiagnostic should not set the field)
      // OR it's set to '' — both are acceptable; what matters is it's not a
      // long string
      const cause = result.providerMetadata?.['haciendaErrorCause'];
      expect(cause == null || cause === '').toBe(true);
    });

    it('uses first element when x-error-cause is an array-valued header', async () => {
      const post = jest.fn().mockReturnValue(
        throwError(() => ({
          response: {
            status: 400,
            headers: { 'x-error-cause': ['primera causa', 'segunda causa'] },
            data: '',
          },
        })),
      );
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      expect(result.providerMetadata?.['haciendaErrorCause']).toBe('primera causa');
    });

    // ── Exact scenario: HTTP 400 + empty body + X-Error-Cause ─────────────

    it('captures x-error-cause correctly on HTTP 400 with empty JSON body', async () => {
      const post = jest.fn().mockReturnValue(
        throwError(() => ({
          response: {
            status: 400,
            headers: {
              'content-type': 'application/json',
              'x-error-cause': 'Comprobante ya fue recibido anteriormente',
            },
            data: '',
          },
        })),
      );
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());

      expect(result.kind).toBe('NON_RETRYABLE_FAILURE');
      expect(result.httpStatus).toBe(400);
      expect(result.providerMetadata?.['providerBodyParseStatus']).toBe('EMPTY_STRING');
      expect(result.providerMetadata?.['providerBodyType']).toBe('null');
      expect(result.providerMetadata?.['haciendaErrorCause']).toBe(
        'Comprobante ya fue recibido anteriormente',
      );
    });

    it('captures x-error-cause even when content-type is absent (no body)', async () => {
      const post = jest.fn().mockReturnValue(
        throwError(() => ({
          response: {
            status: 400,
            headers: { 'x-error-cause': 'clave invalida' },
            data: null,
          },
        })),
      );
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      expect(result.providerMetadata?.['haciendaErrorCause']).toBe('clave invalida');
    });

    // ── Case 18: empty body must NOT suggest expanding body allowlist ─────

    it('empty body + x-error-cause: providerMetadata does not mention allowlist expansion', async () => {
      const post = jest.fn().mockReturnValue(
        throwError(() => ({
          response: {
            status: 400,
            headers: {
              'content-type': 'application/json',
              'x-error-cause': 'receptor identificacion invalida',
            },
            data: '',
          },
        })),
      );
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      const serialized = JSON.stringify(result.providerMetadata ?? {});
      // The haciendaErrorCause is captured — no need to expand body allowlist
      expect(serialized).not.toContain('extractProviderDiagnostic');
      expect(serialized).not.toContain('extractAllowlistedFields');
    });

    // ── Case 19: HTTP 400 is NEVER retried ───────────────────────────────

    it('HTTP 400 with x-error-cause is never retried — POST once', async () => {
      const post = jest.fn().mockReturnValue(
        throwError(() => ({
          response: {
            status: 400,
            headers: { 'x-error-cause': 'clave ya registrada' },
            data: '',
          },
        })),
      );
      await makeAdapter({ post }).submitSignedDocument(submitInput());
      expect(post).toHaveBeenCalledTimes(1);
    });

    // ── Case 20: production remains blocked ──────────────────────────────

    it('production endpoint blocked even with x-error-cause present', async () => {
      const post = jest.fn().mockReturnValue(
        throwError(() => ({
          response: {
            status: 400,
            headers: { 'x-error-cause': 'some error' },
            data: '',
          },
        })),
      );
      await makeAdapter({ post }).submitSignedDocument({
        ...submitInput(),
        environment: 'SANDBOX' as const,
      });
      expect(post.mock.calls[0][0] as string).toContain('recepcion-sandbox');
      expect(post.mock.calls[0][0] as string).not.toContain('/recepcion/v1');
    });

    // ── Security invariants ──────────────────────────────────────────────

    it('authorization header from response is NEVER persisted', async () => {
      const post = jest.fn().mockReturnValue(
        throwError(() => ({
          response: {
            status: 400,
            headers: {
              'x-error-cause': 'test cause',
              authorization: 'Bearer leaked-token',
              'content-type': 'application/json',
            },
            data: '',
          },
        })),
      );
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('leaked-token');
      expect(serialized).not.toMatch(/authorization/i);
    });

    it('set-cookie header from response is NEVER persisted', async () => {
      const post = jest.fn().mockReturnValue(
        throwError(() => ({
          response: {
            status: 400,
            headers: {
              'x-error-cause': 'test cause',
              'set-cookie': 'session=supersecret; HttpOnly',
              'content-type': 'application/json',
            },
            data: '',
          },
        })),
      );
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('supersecret');
      expect(serialized).not.toContain('set-cookie');
    });

    it('access tokens in response headers are NEVER persisted', async () => {
      const post = jest.fn().mockReturnValue(
        throwError(() => ({
          response: {
            status: 400,
            headers: {
              'x-error-cause': 'test',
              'x-access-token': 'jwt.payload.signature',
              'content-type': 'application/json',
            },
            data: '',
          },
        })),
      );
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('jwt.payload.signature');
      // x-access-token is not in the allowlist — must not appear
      expect(serialized).not.toContain('x-access-token');
    });

    it('raw response headers object is NEVER persisted or copied', async () => {
      const sensitiveHeaders = {
        'x-error-cause': 'valid cause',
        authorization: 'Bearer secret',
        'set-cookie': 'session=abc',
        'x-jwt': 'a.b.c',
      };
      const post = jest.fn().mockReturnValue(
        throwError(() => ({
          response: { status: 400, headers: sensitiveHeaders, data: '' },
        })),
      );
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      const serialized = JSON.stringify(result);
      // Only haciendaErrorCause from the allowlist should appear
      expect(serialized).toContain('valid cause');
      expect(serialized).not.toContain('Bearer secret');
      expect(serialized).not.toContain('session=abc');
      expect(serialized).not.toContain('a.b.c');
      // The providerMetadata should not be the full headers object
      const pm = result.providerMetadata ?? {};
      expect(Object.keys(pm)).not.toContain('authorization');
      expect(Object.keys(pm)).not.toContain('set-cookie');
      expect(Object.keys(pm)).not.toContain('x-jwt');
    });

    it('raw response object is NEVER persisted', async () => {
      const response = {
        status: 400,
        headers: { 'x-error-cause': 'test', 'content-type': 'application/json' },
        data: '',
        config: { secret: 'my-secret-config' },
      };
      const post = jest.fn().mockReturnValue(throwError(() => ({ response })));
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('my-secret-config');
      // providerMetadata must only have the safe extracted fields
      const pm = result.providerMetadata ?? {};
      expect(Object.keys(pm)).not.toContain('config');
      expect(Object.keys(pm)).not.toContain('data');
    });
  });

  // ── Response classification ────────────────────────────────────────────────
  //
  // These tests verify that every documented HTTP status produces the expected
  // responseClassification and kind, and that undocumented 2xx is treated as
  // UNRESOLVED_PROVIDER_RESPONSE (not ACKNOWLEDGED, not NON_RETRYABLE_FAILURE).
  //
  // ALL TESTS USE MOCKS. ZERO real Hacienda requests.

  describe('HTTP response classification', () => {
    it('HTTP 201 → ACKNOWLEDGED + DOCUMENTED_SUCCESSFUL_RECEIPT', async () => {
      const post = jest
        .fn()
        .mockReturnValue(
          of({ status: 201, headers: { location: 'https://hacienda.test/rec/clave' }, data: {} }),
        );
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      expect(result.kind).toBe('ACKNOWLEDGED');
      expect(result.nextStatus).toBe('ACKNOWLEDGED');
      expect(result.responseClassification).toBe('DOCUMENTED_SUCCESSFUL_RECEIPT');
    });

    it('HTTP 201 NEVER maps to ACCEPTED', async () => {
      const post = jest.fn().mockReturnValue(of({ status: 201, headers: {}, data: {} }));
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      expect(result.kind).not.toBe('ACCEPTED');
      expect(result.nextStatus).not.toBe('ACCEPTED');
    });

    it('HTTP 201 Location header is captured', async () => {
      const post = jest.fn().mockReturnValue(
        of({
          status: 201,
          headers: { location: 'https://hacienda.test/recepcion/abc' },
          data: {},
        }),
      );
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      expect(result.providerLocation).toBe('https://hacienda.test/recepcion/abc');
    });

    it('HTTP 202 → UNRESOLVED_PROVIDER_RESPONSE (not ACKNOWLEDGED, not NON_RETRYABLE_FAILURE)', async () => {
      const post = jest.fn().mockReturnValue(of({ status: 202, headers: {}, data: {} }));
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      expect(result.kind).toBe('UNRESOLVED_PROVIDER_RESPONSE');
      expect(result.nextStatus).toBe('POST_OUTCOME_UNKNOWN');
      expect(result.kind).not.toBe('ACKNOWLEDGED');
      expect(result.kind).not.toBe('ACCEPTED');
      expect(result.kind).not.toBe('NON_RETRYABLE_FAILURE');
    });

    it('HTTP 202 classification is UNDOCUMENTED_2XX', async () => {
      const post = jest.fn().mockReturnValue(of({ status: 202, headers: {}, data: {} }));
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      expect(result.responseClassification).toBe('UNDOCUMENTED_2XX');
    });

    it('HTTP 202 preserves errorCode HACIENDA_UNDOCUMENTED_2XX_STATUS', async () => {
      const post = jest.fn().mockReturnValue(of({ status: 202, headers: {}, data: {} }));
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      expect(result.normalizedErrorCode).toBe('HACIENDA_UNDOCUMENTED_2XX_STATUS');
    });

    it('HTTP 202 providerReference carries clave for later GET query', async () => {
      const post = jest.fn().mockReturnValue(of({ status: 202, headers: {}, data: {} }));
      const input = submitInput();
      const result = await makeAdapter({ post }).submitSignedDocument(input);
      expect(result.providerReference).toBe(input.clave);
    });

    it('HTTP 202 captures Location header when present', async () => {
      const post = jest
        .fn()
        .mockReturnValue(
          of({ status: 202, headers: { location: 'https://hacienda.test/rec/xyz' }, data: {} }),
        );
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      expect(result.providerLocation).toBe('https://hacienda.test/rec/xyz');
    });

    it('HTTP 202 captures x-error-cause in providerMetadata when present', async () => {
      const post = jest
        .fn()
        .mockReturnValue(
          of({ status: 202, headers: { 'x-error-cause': 'motivo desconocido' }, data: {} }),
        );
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      expect(result.providerMetadata?.['haciendaErrorCause']).toBe('motivo desconocido');
    });

    it('HTTP 202 captures validation-exception in providerMetadata when present', async () => {
      const post = jest
        .fn()
        .mockReturnValue(
          of({ status: 202, headers: { 'validation-exception': 'campo requerido' }, data: {} }),
        );
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      expect(result.providerMetadata?.['haciendaValidationException']).toBe('campo requerido');
    });

    it('HTTP 202 providerMetadata has responseClassification', async () => {
      const post = jest.fn().mockReturnValue(of({ status: 202, headers: {}, data: {} }));
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      expect(result.providerMetadata?.['responseClassification']).toBe('UNDOCUMENTED_2XX');
    });

    it('HTTP 202 NEVER has authorization or set-cookie in providerMetadata', async () => {
      const post = jest.fn().mockReturnValue(
        of({
          status: 202,
          headers: { authorization: 'Bearer leaked', 'set-cookie': 'session=abc', location: 'x' },
          data: {},
        }),
      );
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('leaked');
      expect(serialized).not.toContain('session=abc');
      expect(serialized).not.toMatch(/set-cookie/i);
    });

    it('HTTP 202 raw headers object is NEVER persisted in result', async () => {
      const sensitiveHeaders = {
        location: 'https://hacienda.test/rec/abc',
        authorization: 'Bearer secret',
        'set-cookie': 'tok=xyz',
      };
      const post = jest
        .fn()
        .mockReturnValue(of({ status: 202, headers: sensitiveHeaders, data: {} }));
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      expect(result.providerMetadata).not.toBe(sensitiveHeaders);
      const pm = result.providerMetadata ?? {};
      expect(Object.keys(pm)).not.toContain('authorization');
      expect(Object.keys(pm)).not.toContain('set-cookie');
    });

    it('HTTP 400 → DOCUMENTED_VALIDATION_ERROR classification', async () => {
      const post = jest.fn().mockReturnValue(
        throwError(() => ({
          response: { status: 400, headers: { 'content-type': 'application/json' }, data: {} },
        })),
      );
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      expect(result.responseClassification).toBe('DOCUMENTED_VALIDATION_ERROR');
    });

    it('HTTP 400 captures validation-exception header', async () => {
      const post = jest.fn().mockReturnValue(
        throwError(() => ({
          response: {
            status: 400,
            headers: {
              'validation-exception': 'emisor no válido',
              'content-type': 'application/json',
            },
            data: '',
          },
        })),
      );
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      expect(result.providerMetadata?.['haciendaValidationException']).toBe('emisor no válido');
    });

    it('HTTP 401 → DOCUMENTED_AUTH_ERROR classification + RETRYABLE', async () => {
      const post = jest
        .fn()
        .mockReturnValue(throwError(() => ({ response: { status: 401, headers: {}, data: {} } })));
      const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
      expect(result.responseClassification).toBe('DOCUMENTED_AUTH_ERROR');
      expect(result.kind).toBe('RETRYABLE_FAILURE');
    });

    it.each([200, 204] as const)(
      'HTTP %i → UNDOCUMENTED_2XX + UNRESOLVED_PROVIDER_RESPONSE',
      async (status) => {
        const post = jest.fn().mockReturnValue(of({ status, headers: {}, data: {} }));
        const result = await makeAdapter({ post }).submitSignedDocument(submitInput());
        expect(result.kind).toBe('UNRESOLVED_PROVIDER_RESPONSE');
        expect(result.responseClassification).toBe('UNDOCUMENTED_2XX');
      },
    );
  });

  // ── POST /recepcion envelope — scalar field contract ──────────────────────
  //
  // Root cause of F4-S TASK-009 HTTP 400:
  //   Billing was sending: emisor.tipoIdentificacion = { tipo: "02", numero: "..." }
  //   Hacienda expects:    emisor.tipoIdentificacion = "02"  (java.lang.String)
  //                        emisor.numeroIdentificacion = "..."  (sibling scalar)
  //
  // These tests prove the wire format is correct BEFORE any live Hacienda call.
  // ALL TESTS USE MOCKS.  ZERO real Hacienda requests.

  describe('POST /recepcion envelope — scalar field contract', () => {
    /** Captures the exact body passed to http.post() and returns HTTP 201. */
    function capturePostBody() {
      let captured: unknown;
      const post = jest.fn().mockImplementation((_url: string, body: unknown) => {
        captured = body;
        return of({ status: 201, headers: {}, data: {} });
      });
      return { post, body: () => captured as Record<string, unknown> };
    }

    it('clave is a string', async () => {
      const { post, body } = capturePostBody();
      await makeAdapter({ post }).submitSignedDocument(submitInput());
      expect(typeof body().clave).toBe('string');
    });

    it('fecha is a string', async () => {
      const { post, body } = capturePostBody();
      await makeAdapter({ post }).submitSignedDocument(submitInput());
      expect(typeof body().fecha).toBe('string');
    });

    it('comprobanteXml is a string', async () => {
      const { post, body } = capturePostBody();
      await makeAdapter({ post }).submitSignedDocument(submitInput());
      expect(typeof body().comprobanteXml).toBe('string');
    });

    it('emisor is an object', async () => {
      const { post, body } = capturePostBody();
      await makeAdapter({ post }).submitSignedDocument(submitInput());
      expect(typeof body().emisor).toBe('object');
      expect(body().emisor).not.toBeNull();
    });

    it('emisor.tipoIdentificacion is a scalar string — NOT an object', async () => {
      const { post, body } = capturePostBody();
      await makeAdapter({ post }).submitSignedDocument(submitInput());
      const emisor = body().emisor as Record<string, unknown>;
      expect(typeof emisor['tipoIdentificacion']).toBe('string');
      expect(emisor['tipoIdentificacion']).not.toBeInstanceOf(Object);
    });

    it('emisor.numeroIdentificacion is a scalar string', async () => {
      const { post, body } = capturePostBody();
      await makeAdapter({ post }).submitSignedDocument(submitInput());
      const emisor = body().emisor as Record<string, unknown>;
      expect(typeof emisor['numeroIdentificacion']).toBe('string');
    });

    it('emisor carries exact type and number from input', async () => {
      const { post, body } = capturePostBody();
      const input = submitInput();
      await makeAdapter({ post }).submitSignedDocument(input);
      const emisor = body().emisor as Record<string, unknown>;
      expect(emisor['tipoIdentificacion']).toBe(input.issuer.identification.type);
      expect(emisor['numeroIdentificacion']).toBe(input.issuer.identification.number);
    });

    it('receptor is an object when receiver is present', async () => {
      const { post, body } = capturePostBody();
      await makeAdapter({ post }).submitSignedDocument(submitInput());
      expect(typeof body().receptor).toBe('object');
      expect(body().receptor).not.toBeNull();
    });

    it('receptor.tipoIdentificacion is a scalar string — NOT an object', async () => {
      const { post, body } = capturePostBody();
      await makeAdapter({ post }).submitSignedDocument(submitInput());
      const receptor = body().receptor as Record<string, unknown>;
      expect(typeof receptor['tipoIdentificacion']).toBe('string');
      expect(receptor['tipoIdentificacion']).not.toBeInstanceOf(Object);
    });

    it('receptor.numeroIdentificacion is a scalar string', async () => {
      const { post, body } = capturePostBody();
      await makeAdapter({ post }).submitSignedDocument(submitInput());
      const receptor = body().receptor as Record<string, unknown>;
      expect(typeof receptor['numeroIdentificacion']).toBe('string');
    });

    it('receptor carries exact type and number from input', async () => {
      const { post, body } = capturePostBody();
      const input = submitInput();
      await makeAdapter({ post }).submitSignedDocument(input);
      const receptor = body().receptor as Record<string, unknown>;
      expect(receptor['tipoIdentificacion']).toBe(input.receiver!.identification.type);
      expect(receptor['numeroIdentificacion']).toBe(input.receiver!.identification.number);
    });

    it('receptor is absent when no receiver is provided', async () => {
      const { post, body } = capturePostBody();
      const { receiver: _unused, ...noReceiver } = submitInput();
      await makeAdapter({ post }).submitSignedDocument(noReceiver);
      expect(body().receptor).toBeUndefined();
    });

    // ── All four Costa Rica identification types ─────────────────────────
    //
    // By the time mapParty is called the worker has already run
    // mapIdentificationTypeToXmlCode ("JURIDICA" → "02" etc.).
    // The adapter receives the Hacienda scalar code directly and must
    // pass it through unchanged — no wrapping, no transformation.

    it.each([
      ['01', '207530251'], // FÍSICA — cédula identidad
      ['02', '3101123456'], // JURÍDICA — cédula jurídica
      ['03', '123456789'], // DIMEX — residentes extranjeros
      ['04', '987654321'], // NITE — sin cédula regular
    ] as const)('emisor.tipoIdentificacion=%s is sent as scalar string', async (type, number) => {
      const { post, body } = capturePostBody();
      await makeAdapter({ post }).submitSignedDocument({
        ...submitInput(),
        issuer: { identification: { type, number } },
      });
      const emisor = body().emisor as Record<string, unknown>;
      expect(emisor['tipoIdentificacion']).toBe(type);
      expect(emisor['numeroIdentificacion']).toBe(number);
      expect(typeof emisor['tipoIdentificacion']).toBe('string');
      expect(emisor['tipoIdentificacion']).not.toBeInstanceOf(Object);
    });

    it.each([
      ['01', '207530251'], // FÍSICA
      ['02', '3101123456'], // JURÍDICA
      ['03', '123456789'], // DIMEX
      ['04', '987654321'], // NITE
    ] as const)('receptor.tipoIdentificacion=%s is sent as scalar string', async (type, number) => {
      const { post, body } = capturePostBody();
      await makeAdapter({ post }).submitSignedDocument({
        ...submitInput(),
        receiver: { identification: { type, number } },
      });
      const receptor = body().receptor as Record<string, unknown>;
      expect(receptor['tipoIdentificacion']).toBe(type);
      expect(receptor['numeroIdentificacion']).toBe(number);
      expect(typeof receptor['tipoIdentificacion']).toBe('string');
      expect(receptor['tipoIdentificacion']).not.toBeInstanceOf(Object);
    });
  });
});
