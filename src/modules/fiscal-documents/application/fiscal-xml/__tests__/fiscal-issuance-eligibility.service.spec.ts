import { FiscalIssuanceEligibilityService } from '../fiscal-issuance-eligibility.service';

describe('FiscalIssuanceEligibilityService', () => {
  const query = { tenantId: 'tenant-a', companyId: 'company-a', environment: 'SANDBOX' as const };

  function create(connection: unknown, secret = 'resolved') {
    const prisma = {
      haciendaConnection: { findFirst: jest.fn().mockResolvedValue(connection) },
      fiscalIssuancePoint: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const secrets = { getSecret: jest.fn().mockResolvedValue(secret) };
    return {
      prisma,
      secrets,
      service: new FiscalIssuanceEligibilityService(prisma as never, secrets as never),
    };
  }

  it.each([
    'NOT_CONFIGURED',
    'PENDING_VALIDATION',
    'INVALID_CREDENTIALS',
    'UNAVAILABLE',
    'DISABLED',
  ])('blocks non-CONNECTED Hacienda status %s', async (status) => {
    const { service, secrets } = create({ status, secretReference: 'safe-ref' });
    await expect(service.haciendaEligibility(query)).resolves.toEqual({
      eligible: false,
      reason: 'NOT_CONNECTED',
    });
    expect(secrets.getSecret).not.toHaveBeenCalled();
  });

  it('blocks a missing or unresolvable secret without exposing it', async () => {
    const missing = create({ status: 'CONNECTED', secretReference: '' });
    await expect(missing.service.haciendaEligibility(query)).resolves.toEqual({
      eligible: false,
      reason: 'SECRET_UNAVAILABLE',
    });

    const unavailable = create({ status: 'CONNECTED', secretReference: 'safe-ref' });
    unavailable.secrets.getSecret.mockRejectedValueOnce(new Error('unavailable'));
    await expect(unavailable.service.haciendaEligibility(query)).resolves.toEqual({
      eligible: false,
      reason: 'SECRET_UNAVAILABLE',
    });
  });

  it('returns an internal proof for the exact resolved connection and reference', async () => {
    const { service } = create({
      id: 'connection-a',
      status: 'CONNECTED',
      secretReference: 'safe-ref',
    });

    await expect(service.haciendaEligibility(query)).resolves.toEqual({
      eligible: true,
      connectionId: 'connection-a',
      secretReference: 'safe-ref',
    });
  });
  it('resolves only an active, company/environment-scoped default point', async () => {
    const { prisma, service } = create({ status: 'CONNECTED', secretReference: 'safe-ref' });
    await service.activeDefaultIssuancePoint(query);
    expect(prisma.fiscalIssuancePoint.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        tenantId: 'tenant-a',
        companyId: 'company-a',
        environment: 'SANDBOX',
        active: true,
        isDefault: true,
      }),
      orderBy: { id: 'asc' },
    });
  });
});
