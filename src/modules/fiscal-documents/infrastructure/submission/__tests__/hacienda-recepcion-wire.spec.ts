import { createServer, type Server } from 'node:http';
import axios from 'axios';
import { HttpService } from '@nestjs/axios';
import type { ConfigService } from '@nestjs/config';
import { HaciendaRecepcionAdapter } from '../hacienda-recepcion.adapter';

const clave = '50601012500310112345600100001010000000001100000001';

describe('Hacienda reception HTTP wire contract, local only', () => {
  let server: Server;
  let url: string;
  const requests: Array<{ method: string; path: string; authorization: string[];
    accept: string | undefined; contentType: string | undefined; body: string }> = [];
  let status = 201;
  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        requests.push({ method: req.method ?? '', path: req.url ?? '',
          authorization: req.rawHeaders.flatMap((value, index) =>
            index % 2 === 0 && value.toLowerCase() === 'authorization' ? [req.rawHeaders[index + 1]!] : []),
          accept: req.headers.accept, contentType: req.headers['content-type'],
          body: Buffer.concat(chunks).toString('utf8') });
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(status === 200 ? JSON.stringify({ clave, 'ind-estado': 'procesando' }) : '{}');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}/recepcion-sandbox/v1/`;
  });
  afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });
  beforeEach(() => { requests.length = 0; status = 201; });
  const adapter = () => new HaciendaRecepcionAdapter({ get: () => ({ sandboxBaseUrl: url,
    productionBaseUrl: 'http://127.0.0.1:9/', timeoutMs: 1000 }) } as unknown as ConfigService,
  new HttpService(axios.create({ proxy: false }) as unknown as ConstructorParameters<typeof HttpService>[0]));

  it('sends one bearer header and valid JSON to the official STAG path shape', async () => {
    const result = await adapter().submitSignedDocument({ environment: 'SANDBOX',
      accessToken: 'fake.token.local', clave, consecutive: '00100999010000000001',
      issueDate: new Date('2026-11-16T12:00:00.000Z'), documentType: 'INVOICE',
      issuer: { identification: { type: '02', number: '3101123456' } },
      signedXml: Buffer.from('<FacturaElectronica/>') });
    expect(result.nextStatus).toBe('ACKNOWLEDGED');
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ method: 'POST',
      path: '/recepcion-sandbox/v1/recepcion', authorization: ['bearer fake.token.local'],
      contentType: 'application/json; charset=utf-8' });
    expect(requests[0]!.accept).toContain('application/json');
    expect(JSON.parse(requests[0]!.body)).toMatchObject({ clave,
      comprobanteXml: Buffer.from('<FacturaElectronica/>').toString('base64'),
      emisor: { tipoIdentificacion: '02', numeroIdentificacion: '3101123456' } });
  });

  it.each([[403, 'MANUAL_REVIEW_REQUIRED'], [401, 'TECHNICAL_RETRY_PENDING'],
    [202, 'POST_OUTCOME_UNKNOWN']] as const)('classifies HTTP %i without retry', async (code, next) => {
    status = code;
    const result = await adapter().submitSignedDocument({ environment: 'SANDBOX',
      accessToken: 'fake.token.local', clave, consecutive: '00100999010000000001',
      issueDate: new Date(), documentType: 'INVOICE',
      issuer: { identification: { type: '02', number: '3101123456' } },
      signedXml: Buffer.from('<FacturaElectronica/>') });
    expect(result.nextStatus).toBe(next);
    expect(requests).toHaveLength(1);
  });

  it('queries the documented GET path without submitting', async () => {
    status = 200;
    const result = await adapter().queryStatusByClave({ environment: 'SANDBOX',
      accessToken: 'fake.token.local', clave });
    expect(result.nextStatus).toBe('PROCESSING');
    expect(requests).toMatchObject([{ method: 'GET',
      path: `/recepcion-sandbox/v1/recepcion/${clave}`,
      authorization: ['bearer fake.token.local'] }]);
  });
});
