import { randomUUID } from 'crypto';
import { FiscalIssuanceEligibilityService } from '../../src/modules/fiscal-documents/application/fiscal-xml/fiscal-issuance-eligibility.service';
import { SecretProvider } from '../../src/infrastructure/secrets/ports/secret-provider.port';
import { createGuardedTestPrisma } from '../helpers/guarded-test-prisma';
import {
  assertOwnedTestTenants,
  registerOwnedTestTenant,
  releaseOwnedTestTenants,
} from '../helpers/test-database-ownership';

type GuardedPrisma = Awaited<ReturnType<typeof createGuardedTestPrisma>>['prisma'];

class SyntheticDurableSecrets implements SecretProvider {
  readonly isDurable = true;
  constructor(private readonly values: Map<string, string>) {}
  async getSecret(key: string): Promise<string> {
    const value = this.values.get(key);
    if (!value) throw new Error('Synthetic secret unavailable');
    return value;
  }
  async storeSecret(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
  async deleteSecret(key: string): Promise<void> {
    this.values.delete(key);
  }
}

describe('Wave 2 synthetic operational credential rotation — disposable PostgreSQL', () => {
  let prisma: GuardedPrisma;
  let tenantId: string;
  let companyId: string;
  let otherCompanyId: string;
  let connectionId: string;
  const oldReference = 'wave2/synthetic/old';
  const newReference = 'wave2/synthetic/new';
  let values: Map<string, string>;

  const eligibility = () =>
    new FiscalIssuanceEligibilityService(prisma as never, new SyntheticDurableSecrets(values));

  beforeAll(async () => {
    ({ prisma } = await createGuardedTestPrisma());
    tenantId = randomUUID();
    companyId = randomUUID();
    otherCompanyId = randomUUID();
    connectionId = randomUUID();
    await registerOwnedTestTenant(prisma, tenantId);
    await prisma.tenant.create({
      data: { id: tenantId, name: 'Credential rotation', slug: `rotation-${tenantId.slice(0, 8)}` },
    });
    for (const [id, suffix] of [
      [companyId, '1'],
      [otherCompanyId, '2'],
    ] as const) {
      await prisma.company.create({
        data: {
          id,
          tenantId,
          legalName: `Rotation Company ${suffix}`,
          identificationType: 'JURIDICA',
          identificationNumber: tenantId.replace(/-/g, '').slice(0, 9) + suffix,
          status: 'ACTIVE',
        },
      });
    }
    await prisma.haciendaConnection.create({
      data: {
        id: connectionId,
        tenantId,
        companyId,
        environment: 'SANDBOX',
        status: 'CONNECTED',
        secretReference: oldReference,
      },
    });
  });

  beforeEach(async () => {
    values = new Map([[oldReference, 'synthetic-old-value']]);
    await prisma.haciendaConnection.update({
      where: { id: connectionId },
      data: { status: 'CONNECTED', secretReference: oldReference },
    });
  });

  afterAll(async () => {
    await assertOwnedTestTenants(prisma, [tenantId]);
    await prisma.haciendaConnection.deleteMany({ where: { tenantId } });
    await prisma.fiscalDocument.deleteMany({ where: { tenantId } });
    await prisma.fiscalSequence.deleteMany({ where: { tenantId } });
    await prisma.company.deleteMany({ where: { tenantId } });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
    await releaseOwnedTestTenants(prisma, [tenantId]);
    await prisma.$disconnect();
  });

  it('performs prepare, cutover, old-secret revocation and service restart deterministically', async () => {
    await expect(
      eligibility().haciendaEligibility({ tenantId, companyId, environment: 'SANDBOX' }),
    ).resolves.toMatchObject({ eligible: true, secretReference: oldReference });

    values.set(newReference, 'synthetic-new-value');
    await prisma.haciendaConnection.update({
      where: { id: connectionId },
      data: { secretReference: newReference },
    });
    await expect(
      eligibility().haciendaEligibility({ tenantId, companyId, environment: 'SANDBOX' }),
    ).resolves.toMatchObject({ eligible: true, secretReference: newReference });

    values.delete(oldReference);
    const restartedService = eligibility();
    await expect(
      restartedService.haciendaEligibility({ tenantId, companyId, environment: 'SANDBOX' }),
    ).resolves.toMatchObject({ eligible: true, secretReference: newReference });
    expect(await prisma.fiscalDocument.count({ where: { tenantId } })).toBe(0);
    expect(await prisma.fiscalSequence.count({ where: { tenantId } })).toBe(0);
  });

  it('fails closed for a revoked/invalid reference and recovers after completing cutover', async () => {
    values.delete(oldReference);
    await expect(
      eligibility().haciendaEligibility({ tenantId, companyId, environment: 'SANDBOX' }),
    ).resolves.toEqual({ eligible: false, reason: 'SECRET_UNAVAILABLE' });

    values.set(newReference, 'synthetic-new-value');
    await prisma.haciendaConnection.update({
      where: { id: connectionId },
      data: { secretReference: newReference },
    });
    await expect(
      eligibility().haciendaEligibility({ tenantId, companyId, environment: 'SANDBOX' }),
    ).resolves.toMatchObject({ eligible: true, secretReference: newReference });
  });

  it('does not cross tenant/company/environment boundaries during rotation', async () => {
    values.set(newReference, 'synthetic-new-value');
    await prisma.haciendaConnection.update({
      where: { id: connectionId },
      data: { secretReference: newReference },
    });
    const service = eligibility();
    await expect(
      service.haciendaEligibility({ tenantId, companyId: otherCompanyId, environment: 'SANDBOX' }),
    ).resolves.toEqual({ eligible: false, reason: 'MISSING' });
    await expect(
      service.haciendaEligibility({ tenantId, companyId, environment: 'PRODUCTION' }),
    ).resolves.toEqual({ eligible: false, reason: 'MISSING' });
    await expect(
      service.haciendaEligibility({
        tenantId: randomUUID(),
        companyId,
        environment: 'SANDBOX',
      }),
    ).resolves.toEqual({ eligible: false, reason: 'MISSING' });
  });
});
