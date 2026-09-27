import { FiscalReadinessService } from '../fiscal-readiness.service';

const TENANT_ID = 'tenant-111';
const COMPANY_ID = 'company-222';
const IDENTITY_NUMBER = '3102123456';
const ACTIVITY_ID = 'activity-aaa';
const ACTIVITY_CODE = '6110.0';
const now = new Date('2026-09-13T12:00:00.000Z');
const recentVerifiedAt = new Date('2026-08-20T12:00:00.000Z'); // ~24 days ago — not stale

/** P0-valid default company (verified, inscrito, one active activity as default). */
const defaultCompany = {
  identificationNumber: IDENTITY_NUMBER,
  identificationType: 'JURIDICA',
  haciendaVerificationStatus: 'VERIFIED',
  haciendaVerifiedAt: recentVerifiedAt,
  haciendaTaxSituation: 'Inscrito',
  haciendaMoroso: false,
  haciendaOmiso: false,
};

/** P0-valid default fiscal profile (has defaultEconomicActivityId). */
const defaultProfile = { id: 'profile-1', defaultEconomicActivityId: ACTIVITY_ID };

/** P0-valid default activity. */
const defaultActivity = {
  id: ACTIVITY_ID,
  code: ACTIVITY_CODE,
  description: 'Telecom',
  haciendaStatus: 'A',
  haciendaKind: 'P',
  billingEnabled: true,
};

/** P0-valid default active certificate. */
const defaultCert = {
  id: 'cert-1',
  certificateSecretReference: 'fiscal-certs/company-222/sandbox/cert-aaa',
  passwordSecretReference: 'fiscal-certs/company-222/sandbox/pin-aaa',
  fingerprintSha256: 'a'.repeat(64),
  validFrom: new Date('2026-01-01'),
  validTo: new Date('2027-01-01'),
  extractedIdentityNumber: IDENTITY_NUMBER,
  extractedIdentityType: '02',
  subjectName: 'CN=Test',
};

interface MakePrismaOptions {
  companyFiscalProfile?: object | null | 'default';
  haciendaConnection?: object | null;
  activeCert?: object | null | 'default';
  company?: object | null | 'default';
  fiscalIssuancePoint?: object | null;
  activities?: object[];
}

function makePrisma(overrides: MakePrismaOptions = {}) {
  const profile =
    overrides.companyFiscalProfile === 'default' || overrides.companyFiscalProfile === undefined
      ? defaultProfile
      : overrides.companyFiscalProfile;
  const cert =
    overrides.activeCert === 'default' || overrides.activeCert === undefined
      ? defaultCert
      : overrides.activeCert;
  const company =
    overrides.company === 'default' || overrides.company === undefined
      ? defaultCompany
      : overrides.company;
  const activities = overrides.activities !== undefined ? overrides.activities : [defaultActivity];

  return {
    companyFiscalProfile: { findFirst: jest.fn().mockResolvedValue(profile) },
    haciendaConnection: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          overrides.haciendaConnection !== undefined
            ? overrides.haciendaConnection
            : { id: 'conn-1', status: 'CONNECTED' },
        ),
    },
    fiscalSigningCertificate: { findFirst: jest.fn().mockResolvedValue(cert) },
    company: { findFirst: jest.fn().mockResolvedValue(company) },
    fiscalIssuancePoint: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          overrides.fiscalIssuancePoint !== undefined
            ? overrides.fiscalIssuancePoint
            : { id: 'ip-1' },
        ),
    },
    companyEconomicActivity: { findMany: jest.fn().mockResolvedValue(activities) },
  };
}

function createService(opts: MakePrismaOptions & { secretFailure?: boolean } = {}) {
  const prisma = makePrisma(opts);
  const secrets = {
    isDurable: true,
    getSecret: jest.fn().mockImplementation(() => {
      if (opts.secretFailure) {
        throw new Error('missing secret');
      }
      return Promise.resolve('sentinel-secret-value');
    }),
    storeSecret: jest.fn(),
    deleteSecret: jest.fn(),
  };
  const service = new FiscalReadinessService(prisma as never, secrets as never);
  return { service, prisma, secrets };
}

function makeQuery() {
  return { tenantId: TENANT_ID, companyId: COMPANY_ID, environment: 'SANDBOX' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Full P0 readiness (pre-existing checks + new taxpayer/activity checks)
// ─────────────────────────────────────────────────────────────────────────────

describe('FiscalReadinessService — P0 full readiness', () => {
  beforeAll(() => jest.useFakeTimers().setSystemTime(now));
  afterAll(() => jest.useRealTimers());

  it('readyToIssue = true when all checks pass (including P0 taxpayer + activity)', async () => {
    const { service } = createService();
    const result = await service.evaluate(makeQuery());

    expect(result.readyToIssue).toBe(true);
    expect(result.reasonCodes).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
    expect(result.environment).toBe('SANDBOX');
    expect(result.companyId).toBe(COMPANY_ID);
  });

  it('warnings alone do NOT make readyToIssue false', async () => {
    const { service } = createService({
      company: { ...defaultCompany, haciendaMoroso: true, haciendaOmiso: true },
    });
    const result = await service.evaluate(makeQuery());

    expect(result.readyToIssue).toBe(true);
    expect(result.warnings).toContain('TAXPAYER_MOROSO');
    expect(result.warnings).toContain('TAXPAYER_OMISO');
  });

  it('staleness warning alone does NOT make readyToIssue false', async () => {
    const staleVerifiedAt = new Date('2026-07-01T00:00:00.000Z'); // >30 days ago
    const { service } = createService({
      company: { ...defaultCompany, haciendaVerifiedAt: staleVerifiedAt },
    });
    const result = await service.evaluate(makeQuery());

    expect(result.readyToIssue).toBe(true);
    expect(result.warnings).toContain('ECONOMIC_ACTIVITY_VERIFICATION_STALE');
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
});

// ─────────────────────────────────────────────────────────────────────────────
// Pre-existing hard blockers (fiscal profile, connection, certificate, issuance)
// ─────────────────────────────────────────────────────────────────────────────

describe('FiscalReadinessService — pre-existing hard blockers', () => {
  beforeAll(() => jest.useFakeTimers().setSystemTime(now));
  afterAll(() => jest.useRealTimers());

  it('FISCAL_PROFILE_MISSING when no fiscal profile', async () => {
    const { service } = createService({ companyFiscalProfile: null });
    const result = await service.evaluate(makeQuery());

    expect(result.readyToIssue).toBe(false);
    expect(result.reasonCodes).toContain('FISCAL_PROFILE_MISSING');
  });

  it('HACIENDA_CONNECTION_MISSING + HACIENDA_CREDENTIALS_MISSING when no connection', async () => {
    const { service } = createService({ haciendaConnection: null });
    const result = await service.evaluate(makeQuery());

    expect(result.readyToIssue).toBe(false);
    expect(result.reasonCodes).toContain('HACIENDA_CONNECTION_MISSING');
    expect(result.reasonCodes).toContain('HACIENDA_CREDENTIALS_MISSING');
  });

  it('HACIENDA_CREDENTIALS_MISSING (not CONNECTION_MISSING) when connection is NOT_CONFIGURED', async () => {
    const { service } = createService({
      haciendaConnection: { id: 'conn-1', status: 'NOT_CONFIGURED' },
    });
    const result = await service.evaluate(makeQuery());

    expect(result.readyToIssue).toBe(false);
    expect(result.reasonCodes).toContain('HACIENDA_CREDENTIALS_MISSING');
    expect(result.reasonCodes).not.toContain('HACIENDA_CONNECTION_MISSING');
  });

  it('ACTIVE_CERTIFICATE_MISSING when no cert', async () => {
    const { service } = createService({ activeCert: null });
    const result = await service.evaluate(makeQuery());

    expect(result.readyToIssue).toBe(false);
    expect(result.reasonCodes).toContain('ACTIVE_CERTIFICATE_MISSING');
    expect(result.activeCertificate).toBeNull();
  });

  it('FISCAL_SIGNING_CERTIFICATE_SECRET_UNAVAILABLE when active cert references cannot be resolved', async () => {
    const { service, secrets } = createService({ secretFailure: true });
    const result = await service.evaluate(makeQuery());

    expect(result.readyToIssue).toBe(false);
    expect(result.reasonCodes).toContain('FISCAL_SIGNING_CERTIFICATE_SECRET_UNAVAILABLE');
    expect(secrets.getSecret).toHaveBeenCalledWith(defaultCert.certificateSecretReference);
    expect(secrets.getSecret).toHaveBeenCalledWith(defaultCert.passwordSecretReference);
  });

  it('CERTIFICATE_EXPIRED when cert is expired', async () => {
    const { service } = createService({
      activeCert: {
        ...defaultCert,
        validFrom: new Date('2025-01-01'),
        validTo: new Date('2025-12-31'),
      },
    });
    const result = await service.evaluate(makeQuery());

    expect(result.readyToIssue).toBe(false);
    expect(result.reasonCodes).toContain('CERTIFICATE_EXPIRED');
  });

  it('CERTIFICATE_NOT_YET_VALID when cert is future-dated', async () => {
    const { service } = createService({
      activeCert: {
        ...defaultCert,
        validFrom: new Date('2027-01-01'),
        validTo: new Date('2028-01-01'),
      },
    });
    const result = await service.evaluate(makeQuery());

    expect(result.readyToIssue).toBe(false);
    expect(result.reasonCodes).toContain('CERTIFICATE_NOT_YET_VALID');
  });

  it('CERTIFICATE_IDENTITY_MISMATCH when cert number differs from company', async () => {
    const { service } = createService({
      activeCert: { ...defaultCert, extractedIdentityNumber: '9999999999' },
      company: { ...defaultCompany, identificationNumber: IDENTITY_NUMBER },
    });
    const result = await service.evaluate(makeQuery());

    expect(result.readyToIssue).toBe(false);
    expect(result.reasonCodes).toContain('CERTIFICATE_IDENTITY_MISMATCH');
  });

  it('CERTIFICATE_IDENTITY_MISMATCH when cert type differs from company', async () => {
    const { service } = createService({
      company: { ...defaultCompany, identificationType: 'FISICA' },
      // cert has extractedIdentityType '02' = JURIDICA, but company is FISICA
    });
    const result = await service.evaluate(makeQuery());

    expect(result.readyToIssue).toBe(false);
    expect(result.reasonCodes).toContain('CERTIFICATE_IDENTITY_MISMATCH');
  });

  it('CERTIFICATE_IDENTITY_UNVERIFIED when cert has no extractedIdentityNumber (legacy)', async () => {
    const { service } = createService({
      activeCert: {
        ...defaultCert,
        extractedIdentityNumber: null,
        extractedIdentityType: null,
      },
    });
    const result = await service.evaluate(makeQuery());

    expect(result.readyToIssue).toBe(false);
    expect(result.reasonCodes).toContain('CERTIFICATE_IDENTITY_UNVERIFIED');
  });

  it('ISSUANCE_POINT_MISSING when no issuance point', async () => {
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
});

// ─────────────────────────────────────────────────────────────────────────────
// P0 — Taxpayer validation blockers
// ─────────────────────────────────────────────────────────────────────────────

describe('FiscalReadinessService — P0 taxpayer validation blockers', () => {
  beforeAll(() => jest.useFakeTimers().setSystemTime(now));
  afterAll(() => jest.useRealTimers());

  it('TAXPAYER_VALIDATION_MISSING when company has never been verified', async () => {
    const { service } = createService({
      company: {
        identificationNumber: IDENTITY_NUMBER,
        identificationType: 'JURIDICA',
        haciendaVerificationStatus: null,
        haciendaVerifiedAt: null,
        haciendaTaxSituation: null,
        haciendaMoroso: null,
        haciendaOmiso: null,
      },
    });
    const result = await service.evaluate(makeQuery());

    expect(result.readyToIssue).toBe(false);
    expect(result.reasonCodes).toContain('TAXPAYER_VALIDATION_MISSING');
  });

  it('TAXPAYER_VALIDATION_MISSING when verification status is NOT_FOUND', async () => {
    const { service } = createService({
      company: { ...defaultCompany, haciendaVerificationStatus: 'NOT_FOUND' },
    });
    const result = await service.evaluate(makeQuery());

    expect(result.readyToIssue).toBe(false);
    expect(result.reasonCodes).toContain('TAXPAYER_VALIDATION_MISSING');
  });

  it('TAXPAYER_VALIDATION_MISSING when verification status is UNAVAILABLE', async () => {
    const { service } = createService({
      company: { ...defaultCompany, haciendaVerificationStatus: 'UNAVAILABLE' },
    });
    const result = await service.evaluate(makeQuery());

    expect(result.readyToIssue).toBe(false);
    expect(result.reasonCodes).toContain('TAXPAYER_VALIDATION_MISSING');
  });

  it('TAXPAYER_NOT_ACTIVE when haciendaTaxSituation is Desinscrito', async () => {
    const { service } = createService({
      company: { ...defaultCompany, haciendaTaxSituation: 'Desinscrito' },
    });
    const result = await service.evaluate(makeQuery());

    expect(result.readyToIssue).toBe(false);
    expect(result.reasonCodes).toContain('TAXPAYER_NOT_ACTIVE');
  });

  it('TAXPAYER_MOROSO is a warning only — does NOT make readyToIssue false', async () => {
    const { service } = createService({
      company: { ...defaultCompany, haciendaMoroso: true },
    });
    const result = await service.evaluate(makeQuery());

    expect(result.readyToIssue).toBe(true);
    expect(result.warnings).toContain('TAXPAYER_MOROSO');
    expect(result.reasonCodes).not.toContain('TAXPAYER_MOROSO');
  });

  it('TAXPAYER_OMISO is a warning only — does NOT make readyToIssue false', async () => {
    const { service } = createService({
      company: { ...defaultCompany, haciendaOmiso: true },
    });
    const result = await service.evaluate(makeQuery());

    expect(result.readyToIssue).toBe(true);
    expect(result.warnings).toContain('TAXPAYER_OMISO');
    expect(result.reasonCodes).not.toContain('TAXPAYER_OMISO');
  });

  it('ECONOMIC_ACTIVITY_VERIFICATION_STALE is a warning only when verifiedAt is old', async () => {
    const staleDate = new Date('2026-07-01T00:00:00.000Z'); // > 30 days from "now" (Sep 13)
    const { service } = createService({
      company: { ...defaultCompany, haciendaVerifiedAt: staleDate },
    });
    const result = await service.evaluate(makeQuery());

    expect(result.readyToIssue).toBe(true);
    expect(result.warnings).toContain('ECONOMIC_ACTIVITY_VERIFICATION_STALE');
  });

  it('No staleness warning when verifiedAt is recent', async () => {
    // now = Sep 13, recentVerifiedAt = Aug 20 = ~24 days — below 30-day threshold
    const { service } = createService();
    const result = await service.evaluate(makeQuery());

    expect(result.warnings).not.toContain('ECONOMIC_ACTIVITY_VERIFICATION_STALE');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P0 — Economic activity blockers
// ─────────────────────────────────────────────────────────────────────────────

describe('FiscalReadinessService — P0 activity blockers', () => {
  beforeAll(() => jest.useFakeTimers().setSystemTime(now));
  afterAll(() => jest.useRealTimers());

  it('ECONOMIC_ACTIVITY_MISSING + DEFAULT_ECONOMIC_ACTIVITY_MISSING when no activities exist', async () => {
    const { service } = createService({ activities: [] });
    const result = await service.evaluate(makeQuery());

    expect(result.readyToIssue).toBe(false);
    expect(result.reasonCodes).toContain('ECONOMIC_ACTIVITY_MISSING');
    expect(result.reasonCodes).toContain('DEFAULT_ECONOMIC_ACTIVITY_MISSING');
  });

  it('DEFAULT_ECONOMIC_ACTIVITY_MISSING when activities exist but no default selected (2+ valid activities)', async () => {
    const { service } = createService({
      companyFiscalProfile: { id: 'profile-1', defaultEconomicActivityId: null },
      activities: [
        { ...defaultActivity, id: 'act-1', code: '6110.0' },
        { ...defaultActivity, id: 'act-2', code: '9609.0' },
      ],
    });
    const result = await service.evaluate(makeQuery());

    expect(result.readyToIssue).toBe(false);
    expect(result.reasonCodes).toContain('DEFAULT_ECONOMIC_ACTIVITY_MISSING');
    expect(result.reasonCodes).not.toContain('ECONOMIC_ACTIVITY_MISSING');
  });

  it('no DEFAULT_ECONOMIC_ACTIVITY_MISSING when exactly one valid activity exists and no default set yet', async () => {
    // Single valid active activity — auto-select rule applies (handled by verify handler)
    // Readiness should NOT block — verify handler sets the default during verification
    // But if no default is set yet after verification, readiness is lenient for single activity
    const { service } = createService({
      companyFiscalProfile: { id: 'profile-1', defaultEconomicActivityId: null },
      activities: [{ ...defaultActivity, id: 'act-1', code: '9609.0' }],
    });
    const result = await service.evaluate(makeQuery());

    expect(result.reasonCodes).not.toContain('DEFAULT_ECONOMIC_ACTIVITY_MISSING');
  });

  it('DEFAULT_ECONOMIC_ACTIVITY_INVALID when default activity is inactive (haciendaStatus=I)', async () => {
    const inactiveActivity = { ...defaultActivity, haciendaStatus: 'I' };
    const { service } = createService({
      activities: [inactiveActivity],
    });
    const result = await service.evaluate(makeQuery());

    expect(result.readyToIssue).toBe(false);
    expect(result.reasonCodes).toContain('DEFAULT_ECONOMIC_ACTIVITY_INVALID');
  });

  it('DEFAULT_ECONOMIC_ACTIVITY_INVALID when default activity is billing-disabled', async () => {
    const disabledActivity = { ...defaultActivity, billingEnabled: false };
    const { service } = createService({
      activities: [disabledActivity],
    });
    const result = await service.evaluate(makeQuery());

    expect(result.readyToIssue).toBe(false);
    expect(result.reasonCodes).toContain('DEFAULT_ECONOMIC_ACTIVITY_INVALID');
  });

  it('DEFAULT_ECONOMIC_ACTIVITY_INVALID when default activity id is not in activities list', async () => {
    const { service } = createService({
      companyFiscalProfile: { id: 'profile-1', defaultEconomicActivityId: 'gone-activity-id' },
      activities: [{ ...defaultActivity, id: 'different-id' }],
    });
    const result = await service.evaluate(makeQuery());

    expect(result.readyToIssue).toBe(false);
    expect(result.reasonCodes).toContain('DEFAULT_ECONOMIC_ACTIVITY_INVALID');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Certificate identity — CPF normalization regression
// ─────────────────────────────────────────────────────────────────────────────

describe('FiscalReadinessService — CPF canonical identity', () => {
  beforeAll(() => jest.useFakeTimers().setSystemTime(now));
  afterAll(() => jest.useRealTimers());

  it('readyToIssue includes full P0 for normalized CPF/FISICA certificate', async () => {
    const { service } = createService({
      activeCert: {
        ...defaultCert,
        id: 'cert-cpf',
        fingerprintSha256: 'b'.repeat(64),
        validFrom: new Date('2026-01-01'),
        validTo: new Date('2027-01-01'),
        extractedIdentityNumber: '207530251',
        extractedIdentityType: '01',
        subjectName: 'SERIALNUMBER=CPF-02-0753-0251, CN=Sandbox',
      },
      company: {
        identificationNumber: '207530251',
        identificationType: 'FISICA',
        haciendaVerificationStatus: 'VERIFIED',
        haciendaVerifiedAt: recentVerifiedAt,
        haciendaTaxSituation: 'Inscrito',
        haciendaMoroso: false,
        haciendaOmiso: false,
      },
    });

    const result = await service.evaluate(makeQuery());

    expect(result.readyToIssue).toBe(true);
    expect(result.reasonCodes).toHaveLength(0);
  });

  it('CERTIFICATE_IDENTITY_MISMATCH when cert type 01 (FISICA) but company is JURIDICA', async () => {
    const { service } = createService({
      activeCert: {
        ...defaultCert,
        extractedIdentityNumber: '207530251',
        extractedIdentityType: '01',
      },
      company: {
        ...defaultCompany,
        identificationNumber: '207530251',
        identificationType: 'JURIDICA',
      },
    });
    const result = await service.evaluate(makeQuery());

    expect(result.readyToIssue).toBe(false);
    expect(result.reasonCodes).toContain('CERTIFICATE_IDENTITY_MISMATCH');
  });

  it('bootstrap readyToIssue = false when taxpayer not yet verified (fixes false positive)', async () => {
    // This proves the bootstrap false-positive is fixed:
    // a company with manually-inserted activity code but no taxpayer verification
    // must NOT be readyToIssue.
    const { service } = createService({
      company: {
        identificationNumber: '207530251',
        identificationType: 'FISICA',
        haciendaVerificationStatus: null, // never verified
        haciendaVerifiedAt: null,
        haciendaTaxSituation: null,
        haciendaMoroso: null,
        haciendaOmiso: null,
      },
      activities: [], // no verified activities
    });
    const result = await service.evaluate(makeQuery());

    expect(result.readyToIssue).toBe(false);
    expect(result.reasonCodes).toContain('TAXPAYER_VALIDATION_MISSING');
    expect(result.reasonCodes).toContain('ECONOMIC_ACTIVITY_MISSING');
  });
});
