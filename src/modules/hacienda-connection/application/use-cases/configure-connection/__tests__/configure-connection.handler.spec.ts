import { ConfigureConnectionHandler } from '../configure-connection.handler';
import { HaciendaConnection } from '../../../../domain/entities/hacienda-connection.entity';

const tenantId = 'tenant-id';
const companyId = 'company-id';

function makeHandler(existing: HaciendaConnection | null) {
  const company = { execute: jest.fn().mockResolvedValue({ id: companyId }) };
  const repo = {
    findByCompanyAndEnvironment: jest.fn().mockResolvedValue(existing),
    save: jest.fn().mockResolvedValue(undefined),
  };
  const secrets = { storeSecret: jest.fn().mockResolvedValue(undefined) };
  const cache = { invalidate: jest.fn() };
  const audit = { record: jest.fn() };
  const handler = new ConfigureConnectionHandler(
    company as never,
    repo as never,
    secrets as never,
    cache as never,
    audit as never,
  );
  return { handler, repo, secrets };
}

describe('ConfigureConnectionHandler', () => {
  it('preserves CONNECTED metadata when restoring the full secret for an existing connected sandbox connection', async () => {
    const existing = HaciendaConnection.reconstruct({
      id: 'connection-id',
      tenantId,
      companyId,
      environment: 'SANDBOX',
      status: 'CONNECTED',
      secretReference: `hacienda-conn/${companyId}/SANDBOX`,
      lastValidatedAt: new Date('2026-01-01T00:00:00.000Z'),
      lastSuccessfulAuthAt: new Date('2026-01-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const { handler, repo, secrets } = makeHandler(existing);

    const result = await handler.execute({
      tenantId,
      companyId,
      environment: 'SANDBOX',
      username: 'opaque-user',
      password: 'opaque-password',
      preserveConnectedStatusForSecretRestore: true,
    });

    expect(result.status).toBe('CONNECTED');
    expect(result.id).toBe('connection-id');
    expect(result.secretReference).toBe(`hacienda-conn/${companyId}/SANDBOX`);
    expect(secrets.storeSecret).toHaveBeenCalledWith(
      `hacienda-conn/${companyId}/SANDBOX`,
      JSON.stringify({ username: 'opaque-user', password: 'opaque-password' }),
    );
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'connection-id' }));
  });

  it('keeps normal public credential updates conservative by marking existing connections pending validation', async () => {
    const existing = HaciendaConnection.reconstruct({
      id: 'connection-id',
      tenantId,
      companyId,
      environment: 'SANDBOX',
      status: 'CONNECTED',
      secretReference: `hacienda-conn/${companyId}/SANDBOX`,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const { handler } = makeHandler(existing);

    const result = await handler.execute({
      tenantId,
      companyId,
      environment: 'SANDBOX',
      username: 'opaque-user',
      password: 'opaque-password',
    });

    expect(result.status).toBe('PENDING_VALIDATION');
  });
});
