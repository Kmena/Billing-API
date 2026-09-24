/**
 * Unit tests for f4s-bootstrap-signing-certificate.
 *
 * All tests use in-memory mocks — zero database, zero Hacienda HTTP requests.
 *
 * Coverage:
 *   - creates row when none exists
 *   - ALREADY_CONFIGURED when ACTIVE SANDBOX cert present
 *   - PRODUCTION_TARGET_BLOCKED — PRODUCTION environment rejected
 *   - TENANT_NOT_FOUND — missing tenant row
 *   - COMPANY_NOT_FOUND — company not found under tenant
 *   - References are stored exactly as provided
 *   - verifyTask009Predicate returns row on match, null on miss
 */

import {
  bootstrapSigningCertificate,
  verifyTask009Predicate,
  BootstrapError,
  BootstrapInput,
  BootstrapPrisma,
} from '../../../scripts/f4s-bootstrap-signing-certificate';

// ── Test fixtures ─────────────────────────────────────────────────────────────

const TENANT_ID = '1e620196-2e20-4381-a4e4-327a7fce216b';
const COMPANY_ID = 'aec3ba69-fe76-46ce-a273-197d819a7861';
const CERT_REF = 'f4s/task-009/signing-certificate';
const PASS_REF = 'f4s/task-009/signing-certificate-password';

const SANDBOX_INPUT: BootstrapInput = {
  tenantId: TENANT_ID,
  companyId: COMPANY_ID,
  environment: 'SANDBOX',
  certSecretRef: CERT_REF,
  passSecretRef: PASS_REF,
};

function makeCertRow(overrides: Partial<{
  id: string;
  environment: string;
  status: string;
  certificateSecretReference: string;
  passwordSecretReference: string;
}> = {}) {
  return {
    id: 'aaaa0000-0000-4000-8000-000000000001',
    environment: 'SANDBOX',
    status: 'ACTIVE',
    certificateSecretReference: CERT_REF,
    passwordSecretReference: PASS_REF,
    ...overrides,
  };
}

// ── Prisma mock builder ───────────────────────────────────────────────────────

interface MockSetup {
  tenant?: { id: string } | null;
  company?: { id: string; tenantId: string } | null;
  existingCert?: ReturnType<typeof makeCertRow> | null;
  createdCert?: ReturnType<typeof makeCertRow>;
}

function buildPrisma(setup: MockSetup): BootstrapPrisma & {
  fiscalSigningCertificate: {
    findFirst: jest.Mock;
    create: jest.Mock;
  };
} {
  const {
    tenant = { id: TENANT_ID },
    company = { id: COMPANY_ID, tenantId: TENANT_ID },
    existingCert = null,
    createdCert = makeCertRow(),
  } = setup;

  return {
    tenant: {
      findUnique: jest.fn().mockResolvedValue(tenant),
    },
    company: {
      findFirst: jest.fn().mockResolvedValue(company),
    },
    fiscalSigningCertificate: {
      findFirst: jest.fn().mockResolvedValue(existingCert),
      create: jest.fn().mockResolvedValue(createdCert),
    },
  };
}

// ── Helper: expect BootstrapError ─────────────────────────────────────────────

async function expectBootstrapError(
  action: Promise<unknown>,
  expectedCode: string,
): Promise<void> {
  try {
    await action;
    throw new Error('Expected BootstrapError to be thrown but none was');
  } catch (err) {
    expect(err).toBeInstanceOf(BootstrapError);
    expect((err as BootstrapError).code).toBe(expectedCode);
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('bootstrapSigningCertificate', () => {
  describe('happy path — SANDBOX', () => {
    it('creates exactly one row when none exists and returns CREATED', async () => {
      const prisma = buildPrisma({ existingCert: null });

      const result = await bootstrapSigningCertificate(prisma, SANDBOX_INPUT);

      expect(result.outcome).toBe('CREATED');
      expect(result.environment).toBe('SANDBOX');
      expect(result.status).toBe('ACTIVE');
      expect(result.certRefConfigured).toBe(true);
      expect(result.passRefConfigured).toBe(true);
      expect(typeof result.certificateId).toBe('string');
      expect(result.certificateId).toBeTruthy();
    });

    it('passes exact field values to prisma.create', async () => {
      const prisma = buildPrisma({ existingCert: null });

      await bootstrapSigningCertificate(prisma, SANDBOX_INPUT);

      expect(prisma.fiscalSigningCertificate.create).toHaveBeenCalledTimes(1);
      const createCall = prisma.fiscalSigningCertificate.create.mock.calls[0][0];
      expect(createCall.data).toMatchObject({
        tenantId: TENANT_ID,
        companyId: COMPANY_ID,
        environment: 'SANDBOX',
        status: 'ACTIVE',
        certificateType: 'HACIENDA_CRYPTOGRAPHIC_KEY',
        certificateSecretReference: CERT_REF,
        passwordSecretReference: PASS_REF,
      });
      expect(createCall.data.id).toBeTruthy();
      expect(createCall.data.activeFrom).toBeInstanceOf(Date);
    });

    it('queries idempotency check BEFORE calling create', async () => {
      const prisma = buildPrisma({ existingCert: null });
      const callOrder: string[] = [];

      prisma.fiscalSigningCertificate.findFirst.mockImplementation(async () => {
        callOrder.push('findFirst');
        return null;
      });
      prisma.fiscalSigningCertificate.create.mockImplementation(async () => {
        callOrder.push('create');
        return makeCertRow();
      });

      await bootstrapSigningCertificate(prisma, SANDBOX_INPUT);

      expect(callOrder).toEqual(['findFirst', 'create']);
    });
  });

  describe('idempotency — ALREADY_CONFIGURED', () => {
    it('returns ALREADY_CONFIGURED when ACTIVE SANDBOX cert already exists', async () => {
      const existing = makeCertRow();
      const prisma = buildPrisma({ existingCert: existing });

      const result = await bootstrapSigningCertificate(prisma, SANDBOX_INPUT);

      expect(result.outcome).toBe('ALREADY_CONFIGURED');
      expect(result.certificateId).toBe(existing.id);
      expect(result.environment).toBe('SANDBOX');
      expect(result.status).toBe('ACTIVE');
    });

    it('does NOT call create when cert already exists', async () => {
      const prisma = buildPrisma({ existingCert: makeCertRow() });

      await bootstrapSigningCertificate(prisma, SANDBOX_INPUT);

      expect(prisma.fiscalSigningCertificate.create).not.toHaveBeenCalled();
    });

    it('reports certRefConfigured=false when existing cert has a different secret ref', async () => {
      const existing = makeCertRow({ certificateSecretReference: 'different/ref' });
      const prisma = buildPrisma({ existingCert: existing });

      const result = await bootstrapSigningCertificate(prisma, SANDBOX_INPUT);

      expect(result.outcome).toBe('ALREADY_CONFIGURED');
      expect(result.certRefConfigured).toBe(false);
    });
  });

  describe('safety guard — PRODUCTION blocked', () => {
    it('throws PRODUCTION_TARGET_BLOCKED when environment is PRODUCTION', async () => {
      const prisma = buildPrisma({});
      const prodInput: BootstrapInput = { ...SANDBOX_INPUT, environment: 'PRODUCTION' };

      await expectBootstrapError(
        bootstrapSigningCertificate(prisma, prodInput),
        'PRODUCTION_TARGET_BLOCKED',
      );
    });

    it('throws PRODUCTION_TARGET_BLOCKED before any database call', async () => {
      const prisma = buildPrisma({});
      const prodInput: BootstrapInput = { ...SANDBOX_INPUT, environment: 'PRODUCTION' };

      try {
        await bootstrapSigningCertificate(prisma, prodInput);
      } catch {
        // expected
      }

      expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
      expect(prisma.company.findFirst).not.toHaveBeenCalled();
      expect(prisma.fiscalSigningCertificate.findFirst).not.toHaveBeenCalled();
      expect(prisma.fiscalSigningCertificate.create).not.toHaveBeenCalled();
    });

    it('throws PRODUCTION_TARGET_BLOCKED for arbitrary non-SANDBOX values', async () => {
      const prisma = buildPrisma({});
      for (const env of ['PRODUCTION', 'production', 'LIVE', '']) {
        await expectBootstrapError(
          bootstrapSigningCertificate(prisma, { ...SANDBOX_INPUT, environment: env }),
          'PRODUCTION_TARGET_BLOCKED',
        );
      }
    });
  });

  describe('precondition checks', () => {
    it('throws TENANT_NOT_FOUND when tenant row is missing', async () => {
      const prisma = buildPrisma({ tenant: null });

      await expectBootstrapError(
        bootstrapSigningCertificate(prisma, SANDBOX_INPUT),
        'TENANT_NOT_FOUND',
      );
    });

    it('does not query company when tenant is missing', async () => {
      const prisma = buildPrisma({ tenant: null });

      try {
        await bootstrapSigningCertificate(prisma, SANDBOX_INPUT);
      } catch {
        // expected
      }

      expect(prisma.company.findFirst).not.toHaveBeenCalled();
    });

    it('throws COMPANY_NOT_FOUND when company row is missing', async () => {
      const prisma = buildPrisma({ company: null });

      await expectBootstrapError(
        bootstrapSigningCertificate(prisma, SANDBOX_INPUT),
        'COMPANY_NOT_FOUND',
      );
    });

    it('throws COMPANY_NOT_FOUND when company belongs to a different tenant', async () => {
      const wrongTenantCompany = { id: COMPANY_ID, tenantId: 'wrong-tenant-uuid' };
      // Simulate DB returning null when querying with the correct tenantId constraint
      const prisma = buildPrisma({ company: null });

      // Override findFirst to simulate Prisma's behavior: returns null
      // when tenantId does not match (the where clause includes tenantId)
      (prisma.company.findFirst as jest.Mock).mockResolvedValue(null);

      await expectBootstrapError(
        bootstrapSigningCertificate(prisma, SANDBOX_INPUT),
        'COMPANY_NOT_FOUND',
      );

      // Verify the query included the tenantId constraint
      expect(prisma.company.findFirst).toHaveBeenCalledWith({
        where: { id: COMPANY_ID, tenantId: TENANT_ID },
      });
      void wrongTenantCompany; // used above for documentation clarity
    });

    it('includes tenantId in the company lookup to enforce ownership', async () => {
      const prisma = buildPrisma({});

      await bootstrapSigningCertificate(prisma, SANDBOX_INPUT);

      expect(prisma.company.findFirst).toHaveBeenCalledWith({
        where: { id: COMPANY_ID, tenantId: TENANT_ID },
      });
    });
  });
});

// ── verifyTask009Predicate ────────────────────────────────────────────────────

describe('verifyTask009Predicate', () => {
  it('returns the cert row when the TASK-009 predicate matches', async () => {
    const cert = makeCertRow();
    const prisma = buildPrisma({ existingCert: cert });

    const result = await verifyTask009Predicate(prisma, TENANT_ID, COMPANY_ID);

    expect(result).toEqual(cert);
    expect(prisma.fiscalSigningCertificate.findFirst).toHaveBeenCalledWith({
      where: {
        tenantId: TENANT_ID,
        companyId: COMPANY_ID,
        environment: 'SANDBOX',
        status: 'ACTIVE',
      },
    });
  });

  it('returns null when no ACTIVE SANDBOX cert exists', async () => {
    const prisma = buildPrisma({ existingCert: null });

    const result = await verifyTask009Predicate(prisma, TENANT_ID, COMPANY_ID);

    expect(result).toBeNull();
  });

  it('uses exactly the TASK-009 predicate: environment SANDBOX + status ACTIVE', async () => {
    const prisma = buildPrisma({ existingCert: null });

    await verifyTask009Predicate(prisma, TENANT_ID, COMPANY_ID);

    const whereArg = prisma.fiscalSigningCertificate.findFirst.mock.calls[0][0].where;
    expect(whereArg.environment).toBe('SANDBOX');
    expect(whereArg.status).toBe('ACTIVE');
    expect(whereArg.tenantId).toBe(TENANT_ID);
    expect(whereArg.companyId).toBe(COMPANY_ID);
  });
});

// ── BootstrapError ────────────────────────────────────────────────────────────

describe('BootstrapError', () => {
  it('is an instance of Error', () => {
    const err = new BootstrapError('TEST_CODE', 'test message');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(BootstrapError);
  });

  it('exposes code and message', () => {
    const err = new BootstrapError('MY_CODE', 'my message');
    expect(err.code).toBe('MY_CODE');
    expect(err.message).toBe('my message');
    expect(err.name).toBe('BootstrapError');
  });
});
