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
});
