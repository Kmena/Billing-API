import { MockHaciendaSubmissionAdapter } from '../mock-hacienda-submission.adapter';

const clave = '50601012500310112345600100001010000000001100000001';

function submitInput() {
  return {
    environment: 'SANDBOX' as const,
    accessToken: 'token',
    clave,
    consecutive: '00100001010000000001',
    issueDate: new Date('2025-01-01T00:00:00.000Z'),
    documentType: 'INVOICE' as const,
    issuer: { identification: { type: '02', number: '3101123456' } },
    signedXml: Buffer.from('<FacturaElectronica/>', 'utf8'),
  };
}

describe('MockHaciendaSubmissionAdapter', () => {
  let adapter: MockHaciendaSubmissionAdapter;

  beforeEach(() => {
    adapter = new MockHaciendaSubmissionAdapter();
  });

  it('acknowledges submissions by default without external network', async () => {
    await expect(adapter.submitSignedDocument(submitInput())).resolves.toMatchObject({
      kind: 'ACKNOWLEDGED',
      nextStatus: 'ACKNOWLEDGED',
      httpStatus: 201,
      providerLocation: `mock://hacienda/recepcion/${clave}`,
    });
  });

  it('returns accepted and rejected authoritative artifacts', async () => {
    await expect(
      adapter.queryStatusByClave({ environment: 'SANDBOX', accessToken: 'token', clave }),
    ).resolves.toMatchObject({
      kind: 'ACCEPTED',
      nextStatus: 'ACCEPTED',
      providerStatus: 'aceptado',
      responseArtifact: { contentType: 'application/xml' },
    });

    adapter.setScenario(clave, 'REJECTED');

    await expect(
      adapter.queryStatusByClave({ environment: 'SANDBOX', accessToken: 'token', clave }),
    ).resolves.toMatchObject({
      kind: 'REJECTED',
      nextStatus: 'REJECTED',
      providerStatus: 'rechazado',
      responseArtifact: { contentType: 'application/xml' },
    });
  });

  it('simulates processing before accepted', async () => {
    adapter.setScenario(clave, 'PROCESSING_THEN_ACCEPTED');

    await expect(
      adapter.queryStatusByClave({ environment: 'SANDBOX', accessToken: 'token', clave }),
    ).resolves.toMatchObject({
      kind: 'PROCESSING',
      nextStatus: 'PROCESSING',
      providerStatus: 'procesando',
    });

    await expect(
      adapter.queryStatusByClave({ environment: 'SANDBOX', accessToken: 'token', clave }),
    ).resolves.toMatchObject({
      kind: 'ACCEPTED',
      nextStatus: 'ACCEPTED',
    });
  });

  it.each([
    ['TIMEOUT_UNKNOWN', 'AMBIGUOUS_FAILURE', 'POST_OUTCOME_UNKNOWN'],
    ['RATE_LIMIT', 'RETRYABLE_FAILURE', 'TECHNICAL_RETRY_PENDING'],
    ['PROVIDER_5XX', 'RETRYABLE_FAILURE', 'TECHNICAL_RETRY_PENDING'],
    ['TOKEN_EXPIRED', 'RETRYABLE_FAILURE', 'TECHNICAL_RETRY_PENDING'],
  ] as const)('simulates %s scenario', async (scenario, kind, nextStatus) => {
    adapter.setScenario(clave, scenario);

    await expect(adapter.submitSignedDocument(submitInput())).resolves.toMatchObject({
      kind,
      nextStatus,
    });
  });
});
