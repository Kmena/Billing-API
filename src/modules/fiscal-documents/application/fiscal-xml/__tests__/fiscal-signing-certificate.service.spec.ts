import { HttpException } from '@nestjs/common';
import { FiscalSigningCertificateService } from '../fiscal-signing-certificate.service';
import { FISCAL_XML_ERROR } from '../../../domain/fiscal-xml/fiscal-xml.errors';

const now = new Date('2026-09-13T12:00:00.000Z');

function createCertificate(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    tenantId: '22222222-2222-4222-8222-222222222222',
    companyId: '33333333-3333-4333-8333-333333333333',
    environment: 'SANDBOX',
    status: 'ACTIVE',
    certificateType: 'HACIENDA_CRYPTOGRAPHIC_KEY',
    certificateSecretReference: 'certificates/company/sandbox/material',
    passwordSecretReference: 'certificates/company/sandbox/password',
    fingerprintSha256: 'a'.repeat(64),
    serialNumber: 'SERIAL-1',
    subjectName: 'CN=Billing Test',
    issuerName: 'CN=Test CA',
    validFrom: new Date('2026-01-01T00:00:00.000Z'),
    validTo: new Date('2027-01-01T00:00:00.000Z'),
    activeFrom: new Date('2026-01-01T00:00:00.000Z'),
    createdAt: now,
    updatedAt: now,
    replacedById: null,
    // FR-013: extractedIdentityNumber is populated by the F5 upload API.
    // Default matches the company mock's identificationNumber ('3102123456').
    // Tests that require NULL must explicitly set extractedIdentityNumber: null.
    extractedIdentityNumber: '3102123456',
    extractedIdentityType: '02',
    ...overrides,
  };
}

function createService(
  certificate: Record<string, unknown> | null,
  certificateSecret?: string,
  company?: { identificationNumber: string } | null,
) {
  const prisma = {
    fiscalSigningCertificate: {
      findFirst: jest.fn().mockResolvedValue(certificate),
    },
    company: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          company !== undefined ? company : { identificationNumber: '3102123456' },
        ),
    },
  };
  const secrets = {
    getSecret: jest
      .fn()
      .mockResolvedValueOnce(
        certificateSecret ??
          JSON.stringify({ privateKeyPem: '---PRIVATE KEY---', certificatePem: '---CERT---' }),
      )
      .mockResolvedValueOnce('test-passphrase'),
    storeSecret: jest.fn(),
    deleteSecret: jest.fn(),
  };

  return {
    service: new FiscalSigningCertificateService(prisma as never, secrets),
    prisma,
    secrets,
  };
}

async function expectFailureCode(action: Promise<unknown>, code: string): Promise<void> {
  try {
    await action;
    throw new Error('Expected action to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getResponse()).toMatchObject({ code });
  }
}

describe('FiscalSigningCertificateService', () => {
  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(now);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it('loads active scoped certificate metadata and secrets', async () => {
    const { service, prisma, secrets } = createService(createCertificate());

    const result = await service.getActiveCertificate({
      tenantId: '22222222-2222-4222-8222-222222222222',
      companyId: '33333333-3333-4333-8333-333333333333',
      environment: 'SANDBOX',
    });

    expect(prisma.fiscalSigningCertificate.findFirst).toHaveBeenCalledWith({
      where: {
        tenantId: '22222222-2222-4222-8222-222222222222',
        companyId: '33333333-3333-4333-8333-333333333333',
        environment: 'SANDBOX',
      },
      orderBy: [{ activeFrom: 'desc' }, { createdAt: 'desc' }],
    });
    expect(secrets.getSecret).toHaveBeenCalledWith('certificates/company/sandbox/material');
    expect(secrets.getSecret).toHaveBeenCalledWith('certificates/company/sandbox/password');
    expect(result.secret).toEqual({
      privateKeyPem: '---PRIVATE KEY---',
      certificatePem: '---CERT---',
      passphrase: 'test-passphrase',
    });
  });

  it('loads PKCS#12/PFX material through SecretProvider references', async () => {
    const { service, secrets } = createService(
      createCertificate(),
      JSON.stringify({ pkcs12Base64: Buffer.from('test-only-pfx').toString('base64') }),
    );

    const result = await service.getActiveCertificate({
      tenantId: '22222222-2222-4222-8222-222222222222',
      companyId: '33333333-3333-4333-8333-333333333333',
      environment: 'SANDBOX',
    });

    expect(secrets.getSecret).toHaveBeenCalledWith('certificates/company/sandbox/material');
    expect(secrets.getSecret).toHaveBeenCalledWith('certificates/company/sandbox/password');
    expect(result.secret).toEqual({
      pkcs12Base64: Buffer.from('test-only-pfx').toString('base64'),
      passphrase: 'test-passphrase',
    });
  });

  it('fails when certificate is missing', async () => {
    const { service } = createService(null);

    await expectFailureCode(
      service.getActiveCertificate({
        tenantId: '22222222-2222-4222-8222-222222222222',
        companyId: '33333333-3333-4333-8333-333333333333',
        environment: 'SANDBOX',
      }),
      FISCAL_XML_ERROR.certificateNotConfigured,
    );
  });

  it('fails closed for disabled or future-active certificates without loading secrets', async () => {
    for (const certificate of [
      createCertificate({ status: 'DISABLED' }),
      createCertificate({ validFrom: new Date('2026-12-01T00:00:00.000Z') }),
    ]) {
      const { service, secrets } = createService(certificate);

      await expectFailureCode(
        service.getActiveCertificate({
          tenantId: '22222222-2222-4222-8222-222222222222',
          companyId: '33333333-3333-4333-8333-333333333333',
          environment: 'SANDBOX',
        }),
        FISCAL_XML_ERROR.certificateDisabled,
      );
      expect(secrets.getSecret).not.toHaveBeenCalled();
    }
  });

  it('fails closed for expired certificate without loading secrets', async () => {
    const { service, secrets } = createService(
      createCertificate({ validTo: new Date('2026-01-02T00:00:00.000Z') }),
    );

    await expectFailureCode(
      service.getActiveCertificate({
        tenantId: '22222222-2222-4222-8222-222222222222',
        companyId: '33333333-3333-4333-8333-333333333333',
        environment: 'SANDBOX',
      }),
      FISCAL_XML_ERROR.certificateExpired,
    );
    expect(secrets.getSecret).not.toHaveBeenCalled();
  });

  it('fails closed if returned certificate scope does not match request', async () => {
    const { service, secrets } = createService(createCertificate({ companyId: 'wrong-company' }));

    await expectFailureCode(
      service.getActiveCertificate({
        tenantId: '22222222-2222-4222-8222-222222222222',
        companyId: '33333333-3333-4333-8333-333333333333',
        environment: 'SANDBOX',
      }),
      FISCAL_XML_ERROR.certificateScopeMismatch,
    );
    expect(secrets.getSecret).not.toHaveBeenCalled();
  });

  // ── TASK-004: Defense-in-depth identity check ────────────────────────────

  it('TASK-004 / F5-LEGACY-001: blocks signing when certificate has NULL extractedIdentityNumber', async () => {
    // FR-013: Every signing operation MUST validate certificate identity.
    // NULL extractedIdentityNumber means the cert was uploaded before F5 identity
    // extraction was implemented (F5-LEGACY-001 — e.g. F4-S bootstrap record).
    // Such certs MUST be blocked with FISCAL_CERTIFICATE_IDENTITY_UNVERIFIED.
    // Resolution: operator must re-upload via POST /companies/:id/fiscal-certificates/:env.
    const cert = createCertificate({ extractedIdentityNumber: null });
    const { service, prisma, secrets } = createService(cert);

    await expectFailureCode(
      service.getActiveCertificate({
        tenantId: '22222222-2222-4222-8222-222222222222',
        companyId: '33333333-3333-4333-8333-333333333333',
        environment: 'SANDBOX',
      }),
      FISCAL_XML_ERROR.certificateIdentityUnverified,
    );

    // Company lookup must NOT be called — guard fires before DB query
    expect(prisma.company.findFirst).not.toHaveBeenCalled();
    // Secrets must NOT be loaded
    expect(secrets.getSecret).not.toHaveBeenCalled();
  });

  it('TASK-004: passes when extractedIdentityNumber matches company identificationNumber', async () => {
    const cert = createCertificate({ extractedIdentityNumber: '3102123456' });
    const { service } = createService(cert, undefined, { identificationNumber: '3102123456' });

    const result = await service.getActiveCertificate({
      tenantId: '22222222-2222-4222-8222-222222222222',
      companyId: '33333333-3333-4333-8333-333333333333',
      environment: 'SANDBOX',
    });

    expect(result.id).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('TASK-004: fails before loading secrets when extractedIdentityNumber mismatches company', async () => {
    const cert = createCertificate({ extractedIdentityNumber: '9999999999' });
    const { service, secrets } = createService(cert, undefined, {
      identificationNumber: '3102123456',
    });

    await expectFailureCode(
      service.getActiveCertificate({
        tenantId: '22222222-2222-4222-8222-222222222222',
        companyId: '33333333-3333-4333-8333-333333333333',
        environment: 'SANDBOX',
      }),
      FISCAL_XML_ERROR.certificateEmitterMismatch,
    );

    // Secrets must NOT be loaded when identity check fails
    expect(secrets.getSecret).not.toHaveBeenCalled();
  });

  it('TASK-004: identity check is case and whitespace insensitive', async () => {
    const cert = createCertificate({ extractedIdentityNumber: '  3102123456  ' });
    const { service } = createService(cert, undefined, { identificationNumber: '3102123456' });

    // Should not throw
    const result = await service.getActiveCertificate({
      tenantId: '22222222-2222-4222-8222-222222222222',
      companyId: '33333333-3333-4333-8333-333333333333',
      environment: 'SANDBOX',
    });
    expect(result.id).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('normalizes invalid secret material without exposing secret values', async () => {
    const { service } = createService(
      createCertificate(),
      JSON.stringify({ privateKeyPem: 'secret' }),
    );

    await expectFailureCode(
      service.getActiveCertificate({
        tenantId: '22222222-2222-4222-8222-222222222222',
        companyId: '33333333-3333-4333-8333-333333333333',
        environment: 'SANDBOX',
      }),
      FISCAL_XML_ERROR.certificateInvalidSecret,
    );
  });
});
