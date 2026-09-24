import { FiscalReadinessService } from '../fiscal-readiness.service';

const TENANT_ID = 'tenant-111';
const COMPANY_ID = 'company-222';
const IDENTITY_NUMBER = '3102123456';
const now = new Date('2026-09-13T12:00:00.000Z');

function makePrisma(overrides: {
  companyFiscalProfile?: object | null;
  haciendaConnection?: object | null;
  activeCert?: object | null;
  company?: object | null;
  fiscalIssuancePoint?: object | null;
}) {
  return {
    companyFiscalProfile: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          overrides.companyFiscalProfile !== undefined
            ? overrides.companyFiscalProfile
            : { id: 'profile-1' },
        ),
    },
    haciendaConnection: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          overrides.haciendaConnection !== undefined
            ? overrides.haciendaConnection
            : { id: 'conn-1', status: 'CONNECTED' },
        ),
    },
    fiscalSigningCertificate: {
      findFirst: jest.fn().mockResolvedValue(
        overrides.activeCert !== undefined
          ? overrides.activeCert
          : {
              id: 'cert-1',
              fingerprintSha256: 'a'.repeat(64),
              validFrom: new Date('2026-01-01'),
              validTo: new Date('2027-01-01'),
              extractedIdentityNumber: IDENTITY_NUMBER,
              extractedIdentityType: '02',
              subjectName: 'CN=Test',
            },
      ),
    },
    company: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          overrides.company !== undefined
            ? overrides.company
            : { identificationNumber: IDENTITY_NUMBER },
        ),
    },
    fiscalIssuancePoint: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          overrides.fiscalIssuancePoint !== undefined
            ? overrides.fiscalIssuancePoint
            : { id: 'ip-1' },
        ),
    },
  };
}

function createService(opts: Parameters<typeof makePrisma>[0] = {}) {
  const prisma = makePrisma(opts);
  const service = new FiscalReadinessService(prisma as never);
  return { service, prisma };
}

function makeQuery() {
  return { tenantId: TENANT_ID, companyId: COMPANY_ID, environment: 'SANDBOX' };
}

describe('FiscalReadinessService (TASK-007)', () => {
  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(now);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it('readyToIssue = true when all checks pass', async () => {
    const { service } = createService();
    const result = await service.evaluate(makeQuery());

    expect(result.readyToIssue).toBe(true);
    expect(result.reasonCodes).toHaveLength(0);
    expect(result.environment).toBe('SANDBOX');
    expect(result.companyId).toBe(COMPANY_ID);
  });

  it('readyToIssue = false with FISCAL_PROFILE_MISSING when no fiscal profile', async () => {
    const { service } = createService({ companyFiscalProfile: null });
    const result = await service.evaluate(makeQuery());

    expect(result.readyToIssue).toBe(false);
    expect(result.reasonCodes).toContain('FISCAL_PROFILE_MISSING');
  });

  it('readyToIssue = false with HACIENDA_CONNECTION_MISSING when no connection', async () => {
    const { service } = createService({ haciendaConnection: null });
    const result = await service.evaluate(makeQuery());

    expect(result.readyToIssue).toBe(false);
    expect(result.reasonCodes).toContain('HACIENDA_CONNECTION_MISSING');
    expect(result.reasonCodes).toContain('HACIENDA_CREDENTIALS_MISSING');
  });

  it('readyToIssue = false with HACIENDA_CREDENTIALS_MISSING when connection exists but status is NOT_CONFIGURED', async () => {
    const { service } = createService({
      haciendaConnection: { id: 'conn-1', status: 'NOT_CONFIGURED' },
    });
    const result = await service.evaluate(makeQuery());

    expect(result.readyToIssue).toBe(false);
    expect(result.reasonCodes).toContain('HACIENDA_CREDENTIALS_MISSING');
    expect(result.reasonCodes).not.toContain('HACIENDA_CONNECTION_MISSING');
  });

  it('readyToIssue = false with ACTIVE_CERTIFICATE_MISSING when no cert', async () => {
    const { service } = createService({ activeCert: null });
    const result = await service.evaluate(makeQuery());

    expect(result.readyToIssue).toBe(false);
    expect(result.reasonCodes).toContain('ACTIVE_CERTIFICATE_MISSING');
    expect(result.activeCertificate).toBeNull();
  });

  it('readyToIssue = false with CERTIFICATE_EXPIRED when cert is expired', async () => {
    const { service } = createService({
      activeCert: {
        id: 'cert-1',
        fingerprintSha256: null,
        validFrom: new Date('2025-01-01'),
        validTo: new Date('2025-12-31'), // expired
        extractedIdentityNumber: IDENTITY_NUMBER,
        extractedIdentityType: '02',
        subjectName: null,
      },
    });
    const result = await service.evaluate(makeQuery());

    expect(result.readyToIssue).toBe(false);
    expect(result.reasonCodes).toContain('CERTIFICATE_EXPIRED');
  });

  it('readyToIssue = false with CERTIFICATE_NOT_YET_VALID when cert is future-dated', async () => {
    const { service } = createService({
      activeCert: {
        id: 'cert-1',
        fingerprintSha256: null,
        validFrom: new Date('2027-01-01'), // future
        validTo: new Date('2028-01-01'),
        extractedIdentityNumber: IDENTITY_NUMBER,
        extractedIdentityType: '02',
        subjectName: null,
      },
    });
    const result = await service.evaluate(makeQuery());

    expect(result.readyToIssue).toBe(false);
    expect(result.reasonCodes).toContain('CERTIFICATE_NOT_YET_VALID');
  });

  it('readyToIssue = false with CERTIFICATE_IDENTITY_MISMATCH when cert identity differs from company', async () => {
    const { service } = createService({
      activeCert: {
        id: 'cert-1',
        fingerprintSha256: null,
        validFrom: new Date('2026-01-01'),
        validTo: new Date('2027-01-01'),
        extractedIdentityNumber: '9999999999', // different from company
        extractedIdentityType: '02',
        subjectName: null,
      },
      company: { identificationNumber: IDENTITY_NUMBER },
    });
    const result = await service.evaluate(makeQuery());

    expect(result.readyToIssue).toBe(false);
    expect(result.reasonCodes).toContain('CERTIFICATE_IDENTITY_MISMATCH');
  });

  it('readyToIssue = false with ISSUANCE_POINT_MISSING when no issuance point', async () => {
    const { service } = createService({ fiscalIssuancePoint: null });
    const result = await service.evaluate(makeQuery());

    expect(result.readyToIssue).toBe(false);
    expect(result.reasonCodes).toContain('ISSUANCE_POINT_MISSING');
  });

  it('multiple failure reasons are accumulated', async () => {
    const { service } = createService({
      companyFiscalProfile: null,
      activeCert: null,
      fiscalIssuancePoint: null,
    });
    const result = await service.evaluate(makeQuery());

    expect(result.readyToIssue).toBe(false);
    expect(result.reasonCodes).toContain('FISCAL_PROFILE_MISSING');
    expect(result.reasonCodes).toContain('ACTIVE_CERTIFICATE_MISSING');
    expect(result.reasonCodes).toContain('ISSUANCE_POINT_MISSING');
  });

  it('safe metadata: result never includes secrets or secret references', async () => {
    const { service } = createService();
    const result = await service.evaluate(makeQuery());

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('certificateSecretReference');
    expect(serialized).not.toContain('passwordSecretReference');
    expect(serialized).not.toContain('pkcs12');
    expect(serialized).not.toContain('privateKey');
    expect(serialized).not.toContain('password');
    expect(serialized).not.toContain('pin');
  });

  it('skips identity check when cert has no extractedIdentityNumber (legacy cert)', async () => {
    const { service, prisma } = createService({
      activeCert: {
        id: 'cert-legacy',
        fingerprintSha256: null,
        validFrom: new Date('2026-01-01'),
        validTo: new Date('2027-01-01'),
        extractedIdentityNumber: null, // legacy
        extractedIdentityType: null,
        subjectName: null,
      },
    });
    const result = await service.evaluate(makeQuery());

    // Identity check was skipped
    expect(prisma.company.findFirst).not.toHaveBeenCalled();
    // Should be ready (assuming all other checks pass)
    expect(result.readyToIssue).toBe(true);
  });
});
