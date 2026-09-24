import { NotFoundException } from '@nestjs/common';
import { UpdateCompanyHandler } from '../update-company.handler';
import { FiscalCertificateIdentityConflictException } from '../../../../../fiscal-documents/domain/fiscal-xml/exceptions/fiscal-certificate.exceptions';

const TENANT_ID = 'tenant-aaa';
const COMPANY_ID = 'company-bbb';
const CURRENT_ID_NUMBER = '3102123456';
// Company.identificationType uses Prisma enum strings ('FISICA'|'JURIDICA'|'DIMEX'|'NITE')
const CURRENT_ID_TYPE = 'JURIDICA';
// Certificate extractedIdentityType uses numeric OID codes ('01'|'02'|'03'|'04')
const CERT_ID_TYPE_CODE = '02'; // corresponds to JURIDICA

function makeCurrentCompany(overrides: Record<string, unknown> = {}) {
  return {
    id: COMPANY_ID,
    tenantId: TENANT_ID,
    legalName: 'Test Company SRL',
    tradeName: null,
    identificationNumber: CURRENT_ID_NUMBER,
    // Company.identificationType uses Prisma enum strings
    identificationType: CURRENT_ID_TYPE, // 'JURIDICA'
    status: 'ACTIVE',
    updatedAt: new Date('2026-09-01'),
    ...overrides,
  };
}

function makeActiveCert(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cert-111',
    extractedIdentityNumber: CURRENT_ID_NUMBER,
    // Cert uses numeric code; Company uses Prisma enum string
    extractedIdentityType: CERT_ID_TYPE_CODE,
    ...overrides,
  };
}

function createHandler(opts: {
  company?: ReturnType<typeof makeCurrentCompany> | null;
  activeCert?: ReturnType<typeof makeActiveCert> | null;
  updateResult?: Record<string, unknown>;
}) {
  const updatedCompany = {
    ...makeCurrentCompany(),
    updatedAt: new Date('2026-09-24'),
    ...(opts.updateResult ?? {}),
  };

  const prisma = {
    company: {
      findFirst: jest
        .fn()
        .mockResolvedValue(opts.company !== undefined ? opts.company : makeCurrentCompany()),
      update: jest.fn().mockResolvedValue(updatedCompany),
    },
    fiscalSigningCertificate: {
      findFirst: jest
        .fn()
        .mockResolvedValue(opts.activeCert !== undefined ? opts.activeCert : null),
    },
  };

  const audit = { record: jest.fn() };

  const handler = new UpdateCompanyHandler(prisma as never, audit as never);
  return { handler, prisma, audit };
}

function makeCommand(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: TENANT_ID,
    companyId: COMPANY_ID,
    actorUserId: 'user-1',
    ...overrides,
  };
}

describe('UpdateCompanyHandler (TASK-006)', () => {
  // ── Happy paths ─────────────────────────────────────────────────────────────

  it('updates legalName without triggering identity check when no identity change', async () => {
    const { handler, prisma } = createHandler({});

    await handler.execute(makeCommand({ legalName: 'New Name SRL' }));

    expect(prisma.fiscalSigningCertificate.findFirst).not.toHaveBeenCalled();
    expect(prisma.company.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ legalName: 'New Name SRL' }) }),
    );
  });

  it('allows identity change when no ACTIVE certificate exists', async () => {
    const { handler } = createHandler({ activeCert: null });

    const result = await handler.execute(
      makeCommand({ identificationType: 'FISICA', identificationNumber: '999999999' }),
    );

    expect(result).toBeDefined();
  });

  it('allows identity change when ACTIVE cert has no extractedIdentityNumber (legacy cert)', async () => {
    const { handler } = createHandler({
      activeCert: makeActiveCert({ extractedIdentityNumber: null }),
    });

    const result = await handler.execute(makeCommand({ identificationNumber: '999999999' }));

    expect(result).toBeDefined();
  });

  it('allows identity change when new identity matches ACTIVE cert identity', async () => {
    const { handler } = createHandler({
      activeCert: makeActiveCert({
        extractedIdentityNumber: CURRENT_ID_NUMBER,
        extractedIdentityType: CERT_ID_TYPE_CODE, // '02' maps to JURIDICA
      }),
    });

    // No actual change in values — same number, same type (JURIDICA maps from '02')
    const result = await handler.execute(
      makeCommand({
        identificationNumber: CURRENT_ID_NUMBER,
        identificationType: CURRENT_ID_TYPE, // 'JURIDICA'
      }),
    );

    expect(result).toBeDefined();
  });

  // ── DEC-003: Block incompatible identity changes ──────────────────────────────

  it('DEC-003: blocks identificationNumber change when ACTIVE cert identity would conflict', async () => {
    const { handler } = createHandler({
      activeCert: makeActiveCert({
        extractedIdentityNumber: CURRENT_ID_NUMBER,
        extractedIdentityType: CURRENT_ID_TYPE,
      }),
    });

    await expect(
      handler.execute(makeCommand({ identificationNumber: '9999999999' })),
    ).rejects.toBeInstanceOf(FiscalCertificateIdentityConflictException);
  });

  it('DEC-003: blocked update does NOT modify company or certificate', async () => {
    const { handler, prisma } = createHandler({
      activeCert: makeActiveCert({
        extractedIdentityNumber: CURRENT_ID_NUMBER,
      }),
    });

    await expect(
      handler.execute(makeCommand({ identificationNumber: '8888888888' })),
    ).rejects.toBeInstanceOf(FiscalCertificateIdentityConflictException);

    // Company update must NOT have been called
    expect(prisma.company.update).not.toHaveBeenCalled();
  });

  it('DEC-003: blocked update emits audit event (AC-029/FR-026) without secrets', async () => {
    const { handler, audit } = createHandler({
      activeCert: makeActiveCert(),
    });

    await expect(
      handler.execute(makeCommand({ identificationNumber: '7777777777' })),
    ).rejects.toBeInstanceOf(FiscalCertificateIdentityConflictException);

    // AC-029: audit event MUST be emitted when identity change is blocked
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'company.identity-change-blocked-by-certificate-conflict',
        tenantId: TENANT_ID,
        companyId: COMPANY_ID,
      }),
    );
    // No secrets in audit metadata
    const call = audit.record.mock.calls[0][0] as Record<string, unknown>;
    const serialized = JSON.stringify(call);
    expect(serialized).not.toContain('password');
    expect(serialized).not.toContain('secretRef');
    expect(serialized).not.toContain('pkcs12');
  });

  it('DEC-003: blocks identificationType change when it conflicts with cert extractedIdentityType', async () => {
    const { handler } = createHandler({
      activeCert: makeActiveCert({
        extractedIdentityNumber: CURRENT_ID_NUMBER,
        extractedIdentityType: '02', // maps to JURIDICA in comparison
      }),
    });

    await expect(
      handler.execute(
        makeCommand({
          identificationNumber: CURRENT_ID_NUMBER, // same number
          identificationType: 'FISICA', // changed from JURIDICA → conflict
        }),
      ),
    ).rejects.toBeInstanceOf(FiscalCertificateIdentityConflictException);
  });

  it('DEC-003: unrelated fields (legalName, tradeName) are always updatable even with ACTIVE cert', async () => {
    const { handler } = createHandler({
      activeCert: makeActiveCert(),
    });

    // No identity fields passed — should succeed
    const result = await handler.execute(
      makeCommand({ legalName: 'Updated Name SRL', tradeName: 'Updated Trade' }),
    );

    expect(result).toBeDefined();
  });

  // ── Tenant isolation ──────────────────────────────────────────────────────────

  it('returns 404 when company does not belong to tenant', async () => {
    const { handler } = createHandler({ company: null });

    await expect(handler.execute(makeCommand())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('tenant isolation: cert check is scoped to tenantId + companyId — other tenants have no effect', async () => {
    const { handler, prisma } = createHandler({
      activeCert: null, // No cert for this tenant/company combination
    });

    const result = await handler.execute(makeCommand({ identificationNumber: '5555555555' }));

    // Cert lookup was called with correct tenant scope
    expect(prisma.fiscalSigningCertificate.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: TENANT_ID,
          companyId: COMPANY_ID,
          status: 'ACTIVE',
        }),
      }),
    );
    expect(result).toBeDefined();
  });
});
