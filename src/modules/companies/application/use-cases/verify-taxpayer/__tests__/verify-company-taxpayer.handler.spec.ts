/**
 * TASK-005 unit tests for VerifyCompanyTaxpayerHandler.
 *
 * Coverage:
 *   - FISICA normalization
 *   - JURIDICA normalization (multiple activities, moroso)
 *   - Taxpayer not found (body.code=404)
 *   - Hacienda temporarily unavailable
 *   - Company/taxpayer identity match
 *   - Company/taxpayer identity mismatch (type)
 *   - Multiple activities: principal/secondary preserved
 *   - Exactly one valid activity → auto-default (DEC-002)
 *   - Multiple valid activities → no auto-default
 *   - Previously-active activity not returned → marked inactive, preserved historically
 *   - Tenant isolation: company not found for wrong tenant
 *   - moroso warning persisted
 *   - omiso warning persisted
 */
import { NotFoundException } from '@nestjs/common';
import { VerifyCompanyTaxpayerHandler } from '../verify-company-taxpayer.handler';
import { HaciendaUnavailableException } from '../../../../../../infrastructure/integrations/hacienda/exceptions/hacienda-unavailable.exception';

const TENANT_ID = 'tenant-aaa';
const COMPANY_ID = 'company-bbb';
const FISICA_ID = '207530251';
const JURIDICA_ID = '3101234567';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeCompany(overrides: Record<string, unknown> = {}) {
  return {
    id: COMPANY_ID,
    tenantId: TENANT_ID,
    identificationNumber: FISICA_ID,
    identificationType: 'FISICA',
    status: 'ACTIVE',
    ...overrides,
  };
}

function makeTaxpayerResult(overrides: Record<string, unknown> = {}) {
  return {
    identification: FISICA_ID,
    name: 'PERSONA FISICA SANDBOX',
    found: true,
    identificationType: '01',
    taxSituation: 'Inscrito',
    moroso: false,
    omiso: false,
    economicActivities: [
      {
        code: '9609.0',
        description: 'Otras actividades de servicios personales',
        status: 'A',
        type: 'P',
      },
    ],
    ...overrides,
  };
}

function buildHandler(opts: {
  company?: object | null;
  taxpayer?: object;
  haciendaThrows?: Error;
  existingActivities?: object[];
  existingProfile?: object | null;
}) {
  const company = opts.company !== undefined ? opts.company : makeCompany();
  const taxpayer = opts.taxpayer !== undefined ? opts.taxpayer : makeTaxpayerResult();
  const existingActivities = opts.existingActivities ?? [];
  const existingProfile = opts.existingProfile !== undefined ? opts.existingProfile : null;

  // activity upsert + updateMany tracker
  const upserted: object[] = [];
  const updatedMany: object[] = [];
  const companyUpdated: object[] = [];
  const profileUpdated: object[] = [];

  const activitiesAfterUpsert =
    taxpayer && (taxpayer as any).found
      ? (taxpayer as any).economicActivities.map((a: any, i: number) => ({
          id: `act-${i}`,
          code: a.code,
          description: a.description,
          haciendaStatus: a.status,
          haciendaKind: a.type,
          billingEnabled: true,
          verifiedAt: new Date(),
          lastSeenAt: new Date(),
          verificationSource: 'HACIENDA_FE_AE',
        }))
      : existingActivities;

  const prisma: any = {
    company: {
      findFirst: jest.fn().mockResolvedValue(company),
      update: jest.fn().mockImplementation((args) => {
        companyUpdated.push(args.data);
        return Promise.resolve({ ...company, ...args.data });
      }),
    },
    companyEconomicActivity: {
      upsert: jest.fn().mockImplementation(({ create }) => {
        upserted.push(create);
        return Promise.resolve(create);
      }),
      updateMany: jest.fn().mockImplementation((args) => {
        updatedMany.push(args);
        return Promise.resolve({ count: 0 });
      }),
      findMany: jest.fn().mockResolvedValue(activitiesAfterUpsert),
    },
    companyFiscalProfile: {
      findFirst: jest.fn().mockResolvedValue(existingProfile),
      update: jest.fn().mockImplementation((args) => {
        profileUpdated.push(args.data);
        return Promise.resolve({ ...existingProfile, ...args.data });
      }),
    },
    $transaction: jest.fn().mockImplementation((fn) => fn(prisma)),
  };

  const haciendaPort = opts.haciendaThrows
    ? { getTaxpayer: jest.fn().mockRejectedValue(opts.haciendaThrows) }
    : { getTaxpayer: jest.fn().mockResolvedValue(taxpayer) };

  const auditService = { record: jest.fn() };

  const handler = new VerifyCompanyTaxpayerHandler(
    prisma as never,
    haciendaPort as never,
    auditService as never,
  );

  return {
    handler,
    prisma,
    haciendaPort,
    auditService,
    upserted,
    updatedMany,
    companyUpdated,
    profileUpdated,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// FISICA normalization
// ─────────────────────────────────────────────────────────────────────────────

describe('VerifyCompanyTaxpayerHandler — FISICA normalization', () => {
  it('verifies a FISICA taxpayer and persists verification state', async () => {
    const { handler, companyUpdated } = buildHandler({});
    const result = await handler.execute({
      tenantId: TENANT_ID,
      companyId: COMPANY_ID,
      actor: 'admin',
    });

    expect(result.haciendaVerificationStatus).toBe('VERIFIED');
    expect(result.haciendaName).toBe('PERSONA FISICA SANDBOX');
    expect(result.haciendaTaxSituation).toBe('Inscrito');
    expect(result.moroso).toBe(false);
    expect(result.omiso).toBe(false);
    expect(companyUpdated[0]).toMatchObject({
      haciendaVerificationStatus: 'VERIFIED',
      haciendaMoroso: false,
      haciendaOmiso: false,
    });
  });

  it('imports the economic activity from Hacienda', async () => {
    const { handler, upserted } = buildHandler({});
    const result = await handler.execute({
      tenantId: TENANT_ID,
      companyId: COMPANY_ID,
      actor: 'admin',
    });

    expect(upserted.length).toBe(1);
    expect((upserted[0] as any).code).toBe('9609.0');
    expect((upserted[0] as any).haciendaStatus).toBe('A');
    expect((upserted[0] as any).haciendaKind).toBe('P');
    expect((upserted[0] as any).verificationSource).toBe('HACIENDA_FE_AE');
    expect(result.activities[0].code).toBe('9609.0');
  });

  it('auto-selects single valid activity as default (DEC-002) when profile exists', async () => {
    const profile = { id: 'profile-1', companyId: COMPANY_ID, defaultEconomicActivityId: null };
    const { handler, profileUpdated } = buildHandler({ existingProfile: profile });
    const result = await handler.execute({
      tenantId: TENANT_ID,
      companyId: COMPANY_ID,
      actor: 'admin',
    });

    expect(result.autoSelectedDefaultActivityId).not.toBeNull();
    expect(profileUpdated[0]).toMatchObject({ economicActivityCode: '9609.0' });
  });

  it('does NOT auto-select default when multiple valid activities exist', async () => {
    const twoActivityTaxpayer = makeTaxpayerResult({
      economicActivities: [
        { code: '9609.0', description: 'Act 1', status: 'A', type: 'P' },
        { code: '6110.0', description: 'Act 2', status: 'A', type: 'S' },
      ],
    });
    const profile = { id: 'profile-1', defaultEconomicActivityId: null };
    const { handler } = buildHandler({ taxpayer: twoActivityTaxpayer, existingProfile: profile });
    const result = await handler.execute({
      tenantId: TENANT_ID,
      companyId: COMPANY_ID,
      actor: 'admin',
    });

    expect(result.autoSelectedDefaultActivityId).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// JURIDICA normalization + multiple activities
// ─────────────────────────────────────────────────────────────────────────────

describe('VerifyCompanyTaxpayerHandler — JURIDICA / multiple activities', () => {
  it('preserves principal/secondary marker for multiple activities', async () => {
    const juridicaTaxpayer = {
      identification: JURIDICA_ID,
      name: 'EMPRESA ICE S.A.',
      found: true,
      identificationType: '02',
      taxSituation: 'Inscrito',
      moroso: true,
      omiso: false,
      economicActivities: [
        { code: '6110.0', description: 'Telecom', status: 'A', type: 'P' },
        { code: '3510.0', description: 'Electricidad', status: 'A', type: 'S' },
        { code: '5229.0', description: 'Transporte', status: 'A', type: 'S' },
      ],
    };
    const { handler, upserted } = buildHandler({
      company: makeCompany({ identificationNumber: JURIDICA_ID, identificationType: 'JURIDICA' }),
      taxpayer: juridicaTaxpayer,
    });
    const result = await handler.execute({
      tenantId: TENANT_ID,
      companyId: COMPANY_ID,
      actor: 'admin',
    });

    expect(result.moroso).toBe(true);
    expect(upserted).toHaveLength(3);
    const principal = upserted.find((a: any) => a.code === '6110.0') as any;
    expect(principal.haciendaKind).toBe('P');
    const secondary = upserted.find((a: any) => a.code === '3510.0') as any;
    expect(secondary.haciendaKind).toBe('S');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Not found / unavailable
// ─────────────────────────────────────────────────────────────────────────────

describe('VerifyCompanyTaxpayerHandler — not-found / unavailable', () => {
  it('throws 422 and persists NOT_FOUND when taxpayer not found (body.code=404)', async () => {
    const { handler, companyUpdated } = buildHandler({
      taxpayer: { identification: FISICA_ID, name: '', found: false },
    });

    await expect(
      handler.execute({ tenantId: TENANT_ID, companyId: COMPANY_ID, actor: 'admin' }),
    ).rejects.toMatchObject({ code: 'TAXPAYER_NOT_FOUND' });

    expect(companyUpdated[0]).toMatchObject({ haciendaVerificationStatus: 'NOT_FOUND' });
  });

  it('throws 503 when Hacienda /fe/ae is unavailable (TASK-005 outage handling)', async () => {
    const { handler } = buildHandler({
      haciendaThrows: new HaciendaUnavailableException('getTaxpayer'),
    });

    await expect(
      handler.execute({ tenantId: TENANT_ID, companyId: COMPANY_ID, actor: 'admin' }),
    ).rejects.toMatchObject({ code: 'TAXPAYER_LOOKUP_UNAVAILABLE' });
  });

  it('throws 404 when company not found (tenant isolation)', async () => {
    const { handler } = buildHandler({ company: null });

    await expect(
      handler.execute({ tenantId: TENANT_ID, companyId: COMPANY_ID, actor: 'admin' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Identity mismatch
// ─────────────────────────────────────────────────────────────────────────────

describe('VerifyCompanyTaxpayerHandler — identity mismatch', () => {
  it('throws TAXPAYER_IDENTITY_MISMATCH when Hacienda type code does not match Company type', async () => {
    const { handler } = buildHandler({
      // Company is JURIDICA (02) but Hacienda says type 01 (FISICA)
      company: makeCompany({ identificationType: 'JURIDICA' }),
      taxpayer: makeTaxpayerResult({ identificationType: '01' }),
    });

    await expect(
      handler.execute({ tenantId: TENANT_ID, companyId: COMPANY_ID, actor: 'admin' }),
    ).rejects.toMatchObject({ code: 'TAXPAYER_IDENTITY_MISMATCH' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Historical activity preservation
// ─────────────────────────────────────────────────────────────────────────────

describe('VerifyCompanyTaxpayerHandler — historical activity preservation', () => {
  it('marks previously-active activities not in current response as inactive (updateMany called)', async () => {
    // Current Hacienda response only has 9609.0; 6110.0 was previously known
    const { handler, updatedMany } = buildHandler({});
    await handler.execute({ tenantId: TENANT_ID, companyId: COMPANY_ID, actor: 'admin' });

    expect(updatedMany.length).toBeGreaterThan(0);
    // updateMany for activities not in current set
    const staleUpdate = updatedMany.find((u: any) => u.data?.haciendaStatus === 'I') as any;
    expect(staleUpdate).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// moroso / omiso warning persisted
// ─────────────────────────────────────────────────────────────────────────────

describe('VerifyCompanyTaxpayerHandler — moroso/omiso', () => {
  it('persists moroso=true on Company when Hacienda returns moroso=SI', async () => {
    const { handler, companyUpdated } = buildHandler({
      taxpayer: makeTaxpayerResult({ moroso: true }),
    });
    const result = await handler.execute({
      tenantId: TENANT_ID,
      companyId: COMPANY_ID,
      actor: 'admin',
    });

    expect(result.moroso).toBe(true);
    expect(companyUpdated[0]).toMatchObject({ haciendaMoroso: true });
  });

  it('persists omiso=true on Company when Hacienda returns omiso=SI', async () => {
    const { handler, companyUpdated } = buildHandler({
      taxpayer: makeTaxpayerResult({ omiso: true }),
    });
    const result = await handler.execute({
      tenantId: TENANT_ID,
      companyId: COMPANY_ID,
      actor: 'admin',
    });

    expect(result.omiso).toBe(true);
    expect(companyUpdated[0]).toMatchObject({ haciendaOmiso: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Security: cannot forge verification
// ─────────────────────────────────────────────────────────────────────────────

describe('VerifyCompanyTaxpayerHandler — security', () => {
  it('verificationSource is always HACIENDA_FE_AE (cannot be set by client)', async () => {
    const { handler, upserted } = buildHandler({});
    await handler.execute({ tenantId: TENANT_ID, companyId: COMPANY_ID, actor: 'admin' });

    for (const act of upserted) {
      expect((act as any).verificationSource).toBe('HACIENDA_FE_AE');
    }
  });

  it('audit record is created with verification metadata (no secrets)', async () => {
    const { handler, auditService } = buildHandler({});
    await handler.execute({ tenantId: TENANT_ID, companyId: COMPANY_ID, actor: 'admin' });

    const auditCalled = (auditService.record as jest.Mock).mock.calls[0][0];
    expect(auditCalled.action).toBe('company.taxpayer-verified');
    // No secrets in audit metadata
    const metaSerialized = JSON.stringify(auditCalled.metadata);
    expect(metaSerialized).not.toContain('password');
    expect(metaSerialized).not.toContain('secret');
    expect(metaSerialized).not.toContain('token');
  });
});
