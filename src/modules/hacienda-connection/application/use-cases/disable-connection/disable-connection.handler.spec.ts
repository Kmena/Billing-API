import { DisableConnectionHandler } from './disable-connection.handler';
import { HaciendaConnection } from '../../../domain/entities/hacienda-connection.entity';

const tenantId = 'tenant-id';
const companyId = 'company-id';
const originalUpdatedAt = new Date('2026-01-01T00:00:00.000Z');

function connection(status: 'CONNECTED' | 'DISABLED' = 'CONNECTED') {
  return HaciendaConnection.reconstruct({
    id: 'connection-id',
    tenantId,
    companyId,
    environment: 'SANDBOX',
    status,
    secretReference: `hacienda-conn/${companyId}/SANDBOX/immutable-secret`,
    lastValidatedAt: new Date('2026-01-01T00:00:00.000Z'),
    lastSuccessfulAuthAt: new Date('2026-01-01T00:00:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: originalUpdatedAt,
  });
}

function makeHandler(existing = connection(), saveResult = true) {
  const company = { execute: jest.fn().mockResolvedValue({ id: companyId }) };
  const repo = {
    findByCompanyAndEnvironment: jest.fn().mockResolvedValue(existing),
    save: jest.fn().mockResolvedValue(saveResult),
  };
  const cache = { invalidate: jest.fn() };
  const audit = { record: jest.fn() };
  return {
    handler: new DisableConnectionHandler(
      company as never,
      repo as never,
      cache as never,
      audit as never,
    ),
    repo,
    cache,
    audit,
  };
}

describe('DisableConnectionHandler', () => {
  it('disables atomically without deleting or replacing the credential reference', async () => {
    const existing = connection();
    const reference = existing.secretReference;
    const { handler, repo, cache, audit } = makeHandler(existing);

    const result = await handler.execute(tenantId, companyId, 'SANDBOX');

    expect(result.status).toBe('DISABLED');
    expect(result.secretReference).toBe(reference);
    expect(repo.save).toHaveBeenCalledWith(result, originalUpdatedAt);
    expect(cache.invalidate).toHaveBeenCalledWith(companyId, 'SANDBOX');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'hacienda-connection.disabled',
        metadata: { environment: 'SANDBOX', idempotentReplay: false },
      }),
    );
  });

  it('replays an already-disabled request without another persistence mutation', async () => {
    const existing = connection('DISABLED');
    const { handler, repo, audit } = makeHandler(existing);

    const result = await handler.execute(tenantId, companyId, 'SANDBOX');

    expect(result).toBe(existing);
    expect(repo.save).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { environment: 'SANDBOX', idempotentReplay: true },
      }),
    );
  });

  it('rejects a concurrent configuration change instead of overwriting it', async () => {
    const { handler, cache, audit } = makeHandler(connection(), false);

    await expect(handler.execute(tenantId, companyId, 'SANDBOX')).rejects.toMatchObject({
      response: { code: 'HACIENDA_CONNECTION_CONCURRENT_CONFLICT' },
    });
    expect(cache.invalidate).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});
