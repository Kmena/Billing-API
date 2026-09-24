/**
 * TASK-010: Certificate Lifecycle Audit Events Safety Verification
 *
 * Verifies that all certificate lifecycle audit events:
 * 1. Are emitted at the correct lifecycle points
 * 2. Contain appropriate (non-secret) metadata
 * 3. NEVER contain PIN, PKCS#12 bytes, private key, or secret references
 *
 * Sentinel values are synthetic — never real secrets.
 */
import { NotFoundException } from '@nestjs/common';
import { UploadFiscalSigningCertificateService } from '../upload-fiscal-signing-certificate.service';
import { CrCertificateIdentityExtractorService } from '../cr-certificate-identity-extractor.service';
import { CrCertificateExtractedData } from '../cr-certificate-identity-extractor.service';
import { FiscalCertificateEmitterMismatchException } from '../../../domain/fiscal-xml/exceptions/fiscal-certificate.exceptions';
import { EventClass } from '../../../../audit/application/audit.service';

// ── Sentinel values (synthetic) ───────────────────────────────────────────────
const SENTINEL_PIN = 'AUDIT_TEST_PIN_DO_NOT_LOG_001';
const SENTINEL_B64 = Buffer.from('AUDIT_TEST_P12_CONTENT_002').toString('base64');
const SENTINEL_PRIVATE_KEY =
  '-----BEGIN PRIVATE KEY-----\nAUDIT_TEST_KEY_003\n-----END PRIVATE KEY-----';

const VALID_IDENTITY = '3102123456';
const VALID_COMPANY_ID = '33333333-3333-4333-8333-333333333333';
const VALID_TENANT_ID = '22222222-2222-4222-8222-222222222222';
const now = new Date('2026-09-13T12:00:00.000Z');

function makeExtractedData(
  overrides: Partial<CrCertificateExtractedData> = {},
): CrCertificateExtractedData {
  return {
    fingerprintSha256: 'f'.repeat(64),
    x509SerialNumber: '0AF23B002',
    subjectName: `SERIALNUMBER=CPJ-${VALID_IDENTITY}, CN=Test`,
    issuerName: 'CN=CR Hacienda CA',
    validFrom: new Date('2026-01-01'),
    validTo: new Date('2027-01-01'),
    extractedIdentityNumber: VALID_IDENTITY,
    extractedIdentityType: '02',
    ...overrides,
  };
}

function createService(opts: {
  company?: Record<string, unknown> | null;
  extractorResult?: CrCertificateExtractedData | Error;
}) {
  const certId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const prisma = {
    company: {
      findFirst: jest.fn().mockResolvedValue(
        opts.company !== undefined
          ? opts.company
          : {
              id: VALID_COMPANY_ID,
              tenantId: VALID_TENANT_ID,
              identificationNumber: VALID_IDENTITY,
            },
      ),
    },
    fiscalSigningCertificate: {
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({
        id: certId,
        tenantId: VALID_TENANT_ID,
        companyId: VALID_COMPANY_ID,
        environment: 'SANDBOX',
        status: 'ACTIVE',
        fingerprintSha256: 'f'.repeat(64),
        serialNumber: '0AF23B002',
        subjectName: `SERIALNUMBER=CPJ-${VALID_IDENTITY}, CN=Test`,
        issuerName: 'CN=CR Hacienda CA',
        validFrom: new Date('2026-01-01'),
        validTo: new Date('2027-01-01'),
        extractedIdentityNumber: VALID_IDENTITY,
        extractedIdentityType: '02',
        activeFrom: now,
        replacedById: null,
        createdAt: now,
        updatedAt: now,
      }),
    },
    $transaction: jest.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const txPrisma = {
        fiscalSigningCertificate: {
          findFirst: jest.fn().mockResolvedValue(null),
          update: jest.fn().mockResolvedValue({}),
          create: jest.fn().mockResolvedValue({
            id: certId,
            tenantId: VALID_TENANT_ID,
            companyId: VALID_COMPANY_ID,
            environment: 'SANDBOX',
            status: 'ACTIVE',
            fingerprintSha256: 'f'.repeat(64),
            serialNumber: '0AF23B002',
            subjectName: `SERIALNUMBER=CPJ-${VALID_IDENTITY}, CN=Test`,
            issuerName: 'CN=CR Hacienda CA',
            validFrom: new Date('2026-01-01'),
            validTo: new Date('2027-01-01'),
            extractedIdentityNumber: VALID_IDENTITY,
            extractedIdentityType: '02',
            activeFrom: now,
            replacedById: null,
            createdAt: now,
            updatedAt: now,
          }),
        },
      };
      return fn(txPrisma);
    }),
  };

  const secrets = {
    storeSecret: jest.fn().mockResolvedValue(undefined),
    deleteSecret: jest.fn().mockResolvedValue(undefined),
    getSecret: jest.fn(),
  };

  const extractor = {
    extractAndValidate: jest.fn().mockImplementation(() => {
      if (opts.extractorResult instanceof Error) throw opts.extractorResult;
      return opts.extractorResult ?? makeExtractedData();
    }),
  } as unknown as jest.Mocked<CrCertificateIdentityExtractorService>;

  const auditSpy = jest.fn();
  const mockAudit = { record: auditSpy };

  const service = new UploadFiscalSigningCertificateService(
    prisma as never,
    secrets as never,
    extractor,
    mockAudit as never,
  );

  return { service, prisma, secrets, extractor, auditSpy };
}

function makeCommand(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: VALID_TENANT_ID,
    companyId: VALID_COMPANY_ID,
    environment: 'SANDBOX',
    pkcs12Bytes: Buffer.from('test-cert-bytes'),
    pin: SENTINEL_PIN,
    actorUserId: 'user-admin-1',
    ...overrides,
  };
}

describe('TASK-010: Certificate Lifecycle Audit Events', () => {
  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(now);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  // ── AE-001: Certificate activation ───────────────────────────────────────────

  it('AE-001: emits fiscal-certificate.activated on successful upload', async () => {
    const { service, auditSpy } = createService({});
    await service.execute(makeCommand());

    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'fiscal-certificate.activated',
        eventClass: EventClass.SECURITY,
        tenantId: VALID_TENANT_ID,
        companyId: VALID_COMPANY_ID,
      }),
    );
  });

  it('AE-001: activation audit metadata contains certificateId, environment, fingerprint, actor', async () => {
    const { service, auditSpy } = createService({});
    await service.execute(makeCommand());

    const call = auditSpy.mock.calls[0][0] as Record<string, unknown>;
    const meta = call.metadata as Record<string, unknown>;

    expect(meta.certificateId).toBeDefined();
    expect(meta.environment).toBe('SANDBOX');
    expect(meta.fingerprintSha256).toBeDefined();
    expect(meta.actor).toBe('user-admin-1');
  });

  // ── AE-002: Identity mismatch rejection ───────────────────────────────────────

  it('AE-002: emits fiscal-certificate.upload-rejected on identity mismatch', async () => {
    const { service, auditSpy } = createService({
      extractorResult: makeExtractedData({ extractedIdentityNumber: '9999999999' }),
    });

    await expect(service.execute(makeCommand())).rejects.toBeInstanceOf(
      FiscalCertificateEmitterMismatchException,
    );

    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'fiscal-certificate.upload-rejected',
        eventClass: EventClass.SECURITY,
        metadata: expect.objectContaining({ reason: 'FISCAL_CERTIFICATE_EMITTER_MISMATCH' }),
      }),
    );
  });

  it('AE-002: rejection audit metadata contains environment and actor but NO secrets', async () => {
    const { service, auditSpy } = createService({
      extractorResult: makeExtractedData({ extractedIdentityNumber: '9999999999' }),
    });

    await expect(service.execute(makeCommand({ pin: SENTINEL_PIN }))).rejects.toBeDefined();

    const call = auditSpy.mock.calls[0][0] as Record<string, unknown>;
    const serialized = JSON.stringify(call);

    expect(serialized).not.toContain(SENTINEL_PIN);
    expect(serialized).not.toContain(SENTINEL_B64);
    expect(serialized).not.toContain(SENTINEL_PRIVATE_KEY);
    expect(serialized).not.toContain('pkcs12');
    expect(serialized).not.toContain('password');
    expect(serialized).not.toContain('SecretReference');
  });

  // ── AE-003: No audit on company-not-found ────────────────────────────────────

  it('AE-003: no audit event emitted when company is not found', async () => {
    const { service, auditSpy } = createService({ company: null });

    await expect(service.execute(makeCommand())).rejects.toBeInstanceOf(NotFoundException);

    expect(auditSpy).not.toHaveBeenCalled();
  });

  // ── Security: No secrets in any audit metadata ────────────────────────────────

  it('SEC-001: activation audit metadata NEVER includes sentinel PIN', async () => {
    const { service, auditSpy } = createService({});
    await service.execute(makeCommand({ pin: SENTINEL_PIN }));

    const allCalls = auditSpy.mock.calls;
    const serialized = JSON.stringify(allCalls);

    expect(serialized).not.toContain(SENTINEL_PIN);
  });

  it('SEC-002: activation audit metadata NEVER includes PKCS#12 bytes or base64', async () => {
    const { service, auditSpy } = createService({});
    await service.execute(makeCommand({ pkcs12Bytes: Buffer.from(SENTINEL_B64, 'base64') }));

    const allCalls = auditSpy.mock.calls;
    const serialized = JSON.stringify(allCalls);

    expect(serialized).not.toContain(SENTINEL_B64);
    expect(serialized).not.toContain('pkcs12');
  });

  it('SEC-003: activation audit metadata NEVER includes private key material', async () => {
    const { service, auditSpy } = createService({});
    await service.execute(makeCommand());

    const allCalls = auditSpy.mock.calls;
    const serialized = JSON.stringify(allCalls);

    expect(serialized).not.toContain(SENTINEL_PRIVATE_KEY);
    expect(serialized).not.toContain('PRIVATE KEY');
    expect(serialized).not.toContain('certificateSecretReference');
    expect(serialized).not.toContain('passwordSecretReference');
  });

  it('SEC-004: activation audit metadata NEVER includes secret references', async () => {
    const { service, auditSpy } = createService({});
    await service.execute(makeCommand());

    const allCalls = auditSpy.mock.calls;
    const serialized = JSON.stringify(allCalls);

    // Secret reference strings contain 'fiscal-certs/' — verify absent
    expect(serialized).not.toContain('SecretReference');
    expect(serialized).not.toContain('passwordRef');
    expect(serialized).not.toContain('certRef');
  });
});
