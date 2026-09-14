import {
  HACIENDA_SUBMISSION_PORT,
  type HaciendaSubmissionPort,
  type HaciendaSubmissionResult,
} from '../hacienda-submission.port';

describe('HaciendaSubmissionPort contract', () => {
  it('exposes a symbol token for application dependency inversion', () => {
    expect(typeof HACIENDA_SUBMISSION_PORT).toBe('symbol');
  });

  it('supports processing and authoritative result shapes without raw HTTP client types', async () => {
    const acceptedResult: HaciendaSubmissionResult = {
      kind: 'ACCEPTED',
      nextStatus: 'ACCEPTED',
      providerStatus: 'aceptado',
      responseArtifact: {
        content: Buffer.from('<Respuesta>aceptado</Respuesta>', 'utf8'),
        contentType: 'application/xml',
      },
    };

    const port: HaciendaSubmissionPort = {
      submitSignedDocument: jest.fn().mockResolvedValue({
        kind: 'ACKNOWLEDGED',
        nextStatus: 'ACKNOWLEDGED',
        httpStatus: 201,
        providerLocation: 'https://example.test/recepcion/clave',
      } satisfies HaciendaSubmissionResult),
      queryStatusByClave: jest.fn().mockResolvedValue(acceptedResult),
    };

    await expect(
      port.submitSignedDocument({
        environment: 'SANDBOX',
        accessToken: 'token',
        clave: '50601012500310112345600100001010000000001100000001',
        consecutive: '00100001010000000001',
        issueDate: new Date('2025-01-01T00:00:00.000Z'),
        documentType: 'INVOICE',
        issuer: { identification: { type: '02', number: '3101123456' } },
        signedXml: Buffer.from('<xml/>', 'utf8'),
      }),
    ).resolves.toMatchObject({ kind: 'ACKNOWLEDGED', nextStatus: 'ACKNOWLEDGED' });

    await expect(
      port.queryStatusByClave({
        environment: 'SANDBOX',
        accessToken: 'token',
        clave: '50601012500310112345600100001010000000001100000001',
      }),
    ).resolves.toMatchObject({ kind: 'ACCEPTED', nextStatus: 'ACCEPTED' });
  });
});
