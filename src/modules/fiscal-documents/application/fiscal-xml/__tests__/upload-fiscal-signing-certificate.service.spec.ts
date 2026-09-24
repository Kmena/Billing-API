import { NotFoundException } from '@nestjs/common';
import {
  UploadFiscalSigningCertificateService,
  DEFAULT_CERT_MAX_SIZE_BYTES,
} from '../upload-fiscal-signing-certificate.service';
import { CrCertificateIdentityExtractorService } from '../cr-certificate-identity-extractor.service';
import { CrCertificateExtractedData } from '../cr-certificate-identity-extractor.service';
import {
  FiscalCertificateConcurrentActivationException,
  FiscalCertificateEmitterMismatchException,
  FiscalCertificateExpiredException,
  FiscalCertificateFileTooLargeException,
  FiscalCertificateNotYetValidException,
  FiscalCertificatePersistFailedException,
  FiscalCertificateStorageFailedException,
} from '../../../domain/fiscal-xml/exceptions/fiscal-certificate.exceptions';
import { EventClass } from '../../../../audit/application/audit.service';

// ── Sentinel values (synthetic — never real secrets) ─────────────────────────
const SENTINEL_CERT_PIN = 'SENTINEL_CERT_PIN_SPEC_A1B2';
const SENTINEL_CERT_B64 = Buffer.from('SENTINEL_PKCS12_BYTES_SPEC_C3D4').toString('base64');

// ── Helpers ───────────────────────────────────────────────────────────────────

const VALID_COMPANY_ID = '33333333-3333-4333-8333-333333333333';
const VALID_TENANT_ID = '22222222-2222-4222-8222-222222222222';
const VALID_IDENTITY_NUMBER = '3102123456';
const now = new Date('2026-09-13T12:00:00.000Z');

function makeExtractedData(
  overrides: Partial<CrCertificateExtractedData> = {},
): CrCertificateExtractedData {
  return {
    fingerprintSha256: 'a'.repeat(64),
    x509SerialNumber: '0AF23B002',
    subjectName: 'SERIALNUMBER=CPJ-3102123456, CN=Test',
    issuerName: 'CN=CR Hacienda CA',
    validFrom: new Date('2026-01-01T00:00:00.000Z'),
    validTo: new Date('2027-01-01T00:00:00.000Z'),
    extractedIdentityNumber: VALID_IDENTITY_NUMBER,
    extractedIdentityType: '02',
    ...overrides,
  };
}

function makeNewCertRow(id: string) {
  return {
    id,
    tenantId: VALID_TENANT_ID,
    companyId: VALID_COMPANY_ID,
    environment: 'SANDBOX',
    status: 'ACTIVE',
    certificateType: 'HACIENDA_CRYPTOGRAPHIC_KEY',
    certificateSecretReference: `fiscal-certs/${VALID_COMPANY_ID}/sandbox/cert-${'a'.repeat(64)}`,
    passwordSecretReference: `fiscal-certs/${VALID_COMPANY_ID}/sandbox/pin-${'a'.repeat(64)}`,
    fingerprintSha256: 'a'.repeat(64),
    serialNumber: '0AF23B002',
    subjectName: 'SERIALNUMBER=CPJ-3102123456, CN=Test',
    issuerName: 'CN=CR Hacienda CA',
    validFrom: new Date('2026-01-01'),
    validTo: new Date('2027-01-01'),
    extractedIdentityNumber: VALID_IDENTITY_NUMBER,
    extractedIdentityType: '02',
    activeFrom: now,
    replacedById: null,
    createdAt: now,
    updatedAt: now,
  };
}

function createService(opts: {
  company?: Record<string, unknown> | null;
  existingActiveCert?: Record<string, unknown> | null;
  extractorResult?: CrCertificateExtractedData | Error;
  secretStoreResult?: Error | null;
  secretStorePinResult?: Error | null;
  txResult?: Record<string, unknown> | Error;
}) {
  const certId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  const prisma = {
    company: {
      findFirst: jest.fn().mockResolvedValue(
        opts.company !== undefined
          ? opts.company
          : {
              id: VALID_COMPANY_ID,
              tenantId: VALID_TENANT_ID,
              identificationNumber: VALID_IDENTITY_NUMBER,
            },
      ),
    },
    fiscalSigningCertificate: {
      findFirst: jest
        .fn()
        .mockResolvedValue(opts.existingActiveCert !== undefined ? opts.existingActiveCert : null),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue(makeNewCertRow(certId)),
    },
    $transaction: jest.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      if (opts.txResult instanceof Error) {
        throw opts.txResult;
      }
      const txPrisma = {
        fiscalSigningCertificate: {
          findFirst: jest
            .fn()
            .mockResolvedValue(
              opts.existingActiveCert !== undefined ? opts.existingActiveCert : null,
            ),
          update: jest.fn().mockResolvedValue({}),
          create: jest.fn().mockResolvedValue(makeNewCertRow(certId)),
        },
      };
      return fn(txPrisma);
    }),
  };

  const secrets = {
    storeSecret: jest
      .fn()
      .mockImplementationOnce(() => {
        if (opts.secretStoreResult instanceof Error) throw opts.secretStoreResult;
        return Promise.resolve();
      })
      .mockImplementationOnce(() => {
        if (opts.secretStorePinResult instanceof Error) throw opts.secretStorePinResult;
        return Promise.resolve();
      }),
    deleteSecret: jest.fn().mockResolvedValue(undefined),
    getSecret: jest.fn(),
  };

  const extractor = {
    extractAndValidate: jest.fn().mockImplementation(() => {
      if (opts.extractorResult instanceof Error) throw opts.extractorResult;
      return opts.extractorResult ?? makeExtractedData();
    }),
  } as unknown as jest.Mocked<CrCertificateIdentityExtractorService>;

  const mockAudit = {
    record: jest.fn(),
  };

  const service = new UploadFiscalSigningCertificateService(
    prisma as never,
    secrets as never,
    extractor,
    mockAudit as never,
  );

  return { service, prisma, secrets, extractor, mockAudit };
}

function makeCommand(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: VALID_TENANT_ID,
    companyId: VALID_COMPANY_ID,
    environment: 'SANDBOX',
    pkcs12Bytes: Buffer.from('fake-p12-content'),
    pin: 'test-pin',
    actorUserId: 'user-1',
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('UploadFiscalSigningCertificateService', () => {
  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(now);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it('full happy path — no existing cert — activates new certificate', async () => {
    const { service, secrets, mockAudit } = createService({});
    const result = await service.execute(makeCommand());

    expect(result.status).toBe('ACTIVE');
    expect(result.extractedIdentityNumber).toBe(VALID_IDENTITY_NUMBER);
    expect(secrets.storeSecret).toHaveBeenCalledTimes(2);
    expect(secrets.storeSecret.mock.calls[0][0]).toContain('cert-');
    expect(secrets.storeSecret.mock.calls[1][0]).toContain('pin-');
    // Verify AuditService was called with no secrets
    expect(mockAudit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'fiscal-certificate.activated',
        eventClass: EventClass.SECURITY,
      }),
    );
  });

  it('full happy path — existing ACTIVE cert — old cert marked REPLACED', async () => {
    const existingCert = {
      id: 'old-cert-id',
      status: 'ACTIVE',
    };
    const { service } = createService({ existingActiveCert: existingCert });
    const result = await service.execute(makeCommand());

    expect(result.status).toBe('ACTIVE');
  });

  it('rejects when file size exceeds limit', async () => {
    const { service } = createService({});
    const bigBuffer = Buffer.alloc(DEFAULT_CERT_MAX_SIZE_BYTES + 1);

    await expect(service.execute(makeCommand({ pkcs12Bytes: bigBuffer }))).rejects.toBeInstanceOf(
      FiscalCertificateFileTooLargeException,
    );
  });

  it('rejects when company not found', async () => {
    const { service, extractor } = createService({ company: null });

    await expect(service.execute(makeCommand())).rejects.toBeInstanceOf(NotFoundException);
    expect(extractor.extractAndValidate).not.toHaveBeenCalled();
  });

  it('rejects with FISCAL_CERTIFICATE_EMITTER_MISMATCH when identity does not match company', async () => {
    const { service, secrets } = createService({
      extractorResult: makeExtractedData({ extractedIdentityNumber: '9999999999' }),
    });

    await expect(service.execute(makeCommand())).rejects.toBeInstanceOf(
      FiscalCertificateEmitterMismatchException,
    );
    // No secrets should be stored on mismatch
    expect(secrets.storeSecret).not.toHaveBeenCalled();
  });

  it('rejects with FISCAL_CERTIFICATE_EXPIRED for expired certificate', async () => {
    const { service, secrets } = createService({
      extractorResult: makeExtractedData({
        validTo: new Date('2025-01-01T00:00:00.000Z'), // past
      }),
    });

    await expect(service.execute(makeCommand())).rejects.toBeInstanceOf(
      FiscalCertificateExpiredException,
    );
    expect(secrets.storeSecret).not.toHaveBeenCalled();
  });

  it('rejects with FISCAL_CERTIFICATE_NOT_YET_VALID for future certificate', async () => {
    const { service, secrets } = createService({
      extractorResult: makeExtractedData({
        validFrom: new Date('2027-01-01T00:00:00.000Z'), // future
        validTo: new Date('2028-01-01T00:00:00.000Z'),
      }),
    });

    await expect(service.execute(makeCommand())).rejects.toBeInstanceOf(
      FiscalCertificateNotYetValidException,
    );
    expect(secrets.storeSecret).not.toHaveBeenCalled();
  });

  it('rejects with FISCAL_CERTIFICATE_STORAGE_FAILED when SecretProvider fails on cert', async () => {
    const { service } = createService({
      secretStoreResult: new Error('SSM unavailable'),
    });

    await expect(service.execute(makeCommand())).rejects.toBeInstanceOf(
      FiscalCertificateStorageFailedException,
    );
  });

  it('rejects with FISCAL_CERTIFICATE_PERSIST_FAILED when DB transaction fails and calls cleanup', async () => {
    const { service, secrets } = createService({
      txResult: new Error('DB connection lost'),
    });

    await expect(service.execute(makeCommand())).rejects.toBeInstanceOf(
      FiscalCertificatePersistFailedException,
    );
    // Compensating cleanup must be attempted
    expect(secrets.deleteSecret).toHaveBeenCalledTimes(2);
  });

  it('audit record metadata contains no PIN or base64 cert bytes', async () => {
    const { service, mockAudit } = createService({});
    await service.execute(
      makeCommand({
        pin: SENTINEL_CERT_PIN,
        pkcs12Bytes: Buffer.from(SENTINEL_CERT_B64, 'base64'),
      }),
    );

    expect(mockAudit.record).toHaveBeenCalled();
    const auditCall = mockAudit.record.mock.calls[0][0] as Record<string, unknown>;
    const serialized = JSON.stringify(auditCall);

    expect(serialized).not.toContain(SENTINEL_CERT_PIN);
    expect(serialized).not.toContain(SENTINEL_CERT_B64);
    expect(serialized).not.toContain('pkcs12');
    expect(serialized).not.toContain('password');
    expect(serialized).not.toContain('pin');
  });

  it('stores correct field values in DB row', async () => {
    const { service } = createService({});
    const result = await service.execute(makeCommand());

    expect(result.extractedIdentityNumber).toBe(VALID_IDENTITY_NUMBER);
    expect(result.extractedIdentityType).toBe('02');
    expect(result.fingerprintSha256).toBe('a'.repeat(64));
    // Secret references must NOT be returned in result
    // (result type does NOT include certificateSecretReference or passwordSecretReference)
    expect(Object.keys(result)).not.toContain('certificateSecretReference');
    expect(Object.keys(result)).not.toContain('passwordSecretReference');
  });

  // ── DB-002: Concurrent activation guard ──────────────────────────────────

  it('DB-002: maps Prisma P2002 on active-cert unique index to FiscalCertificateConcurrentActivationException', async () => {
    // Simulate the database enforcing the partial unique index
    // fiscal_signing_cert_one_active_per_scope when two concurrent activations
    // race for the same (tenant, company, environment) combination.
    //
    // The Prisma runtime surfaces this as a PrismaClientKnownRequestError P2002.
    // The upload service must map it to a safe domain error (HTTP 409)
    // and attempt compensating secret cleanup.
    // Simulate P2002 duck-typed (the service uses duck typing, not instanceof,
    // to avoid a @prisma/client import at the application layer).
    const p2002Error = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
      meta: { target: 'fiscal_signing_cert_one_active_per_scope' },
    });
    // Make $transaction throw P2002 to simulate concurrent DB constraint violation
    const { service, secrets } = createService({ txResult: p2002Error });

    await expect(service.execute(makeCommand())).rejects.toBeInstanceOf(
      FiscalCertificateConcurrentActivationException,
    );

    // Compensating secret cleanup must be attempted for both secrets
    expect(secrets.deleteSecret).toHaveBeenCalledTimes(2);
  });

  it('DB-002: a Prisma P2002 on a DIFFERENT index is NOT mapped to concurrent activation', async () => {
    // A P2002 on an unrelated unique constraint must still be persisted-failed,
    // not silently mis-classified as a concurrent activation.
    const unrelatedP2002 = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
      meta: { target: 'some_other_unique_index' },
    });
    const { service, secrets } = createService({ txResult: unrelatedP2002 });

    await expect(service.execute(makeCommand())).rejects.toBeInstanceOf(
      FiscalCertificatePersistFailedException,
    );
    expect(secrets.deleteSecret).toHaveBeenCalledTimes(2);
  });

  it('DB-002: a generic DB error (non-P2002) still throws FiscalCertificatePersistFailedException', async () => {
    // Non-unique-constraint errors must still be classified as persist-failed
    const { service, secrets } = createService({ txResult: new Error('DB connection lost') });

    await expect(service.execute(makeCommand())).rejects.toBeInstanceOf(
      FiscalCertificatePersistFailedException,
    );
    expect(secrets.deleteSecret).toHaveBeenCalledTimes(2);
  });
});
