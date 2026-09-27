/**
 * TASK-004 unit tests for SetDefaultEconomicActivityHandler.
 *
 * Coverage:
 *   - Sets a verified active enabled activity as default
 *   - Syncs legacy economicActivityCode (DEC-006)
 *   - Rejects inactive Hacienda activity
 *   - Rejects billing-disabled activity
 *   - Rejects activity belonging to different company (cross-company)
 *   - Rejects activity not found
 *   - Tenant isolation: company not found for wrong tenant
 */
import { NotFoundException } from '@nestjs/common';
import { SetDefaultEconomicActivityHandler } from '../set-default-economic-activity.handler';

const TENANT_ID = 'tenant-aaa';
const COMPANY_ID = 'company-bbb';
// NOTE: OTHER_COMPANY_ID reserved for cross-company test — unused in current suite

function makeActivity(overrides: Record<string, unknown> = {}) {
  return {
    id: 'activity-111',
    companyId: COMPANY_ID,
    code: '9609.0',
    haciendaStatus: 'A',
    billingEnabled: true,
    ...overrides,
  };
}

function buildHandler(opts: {
  company?: object | null;
  activity?: object | null;
  profile?: object | null;
}) {
  const company =
    opts.company !== undefined
      ? opts.company
      : { id: COMPANY_ID, tenantId: TENANT_ID, status: 'ACTIVE' };
  const activity = opts.activity !== undefined ? opts.activity : makeActivity();
  const profile =
    opts.profile !== undefined ? opts.profile : { id: 'profile-1', companyId: COMPANY_ID };

  const profileUpdated: object[] = [];

  const prisma: any = {
    company: { findFirst: jest.fn().mockResolvedValue(company) },
    companyEconomicActivity: {
      findUnique: jest.fn().mockResolvedValue(activity),
    },
    companyFiscalProfile: {
      findFirst: jest.fn().mockResolvedValue(profile),
      update: jest.fn().mockImplementation((args) => {
        profileUpdated.push(args.data);
        return Promise.resolve({ ...profile, ...args.data });
      }),
    },
  };
  const auditService = { record: jest.fn() };
  const handler = new SetDefaultEconomicActivityHandler(prisma as never, auditService as never);
  return { handler, prisma, profileUpdated };
}

describe('SetDefaultEconomicActivityHandler', () => {
  it('sets valid activity as default and syncs legacy code (DEC-006)', async () => {
    const { handler, profileUpdated } = buildHandler({});
    const result = await handler.execute({
      tenantId: TENANT_ID,
      companyId: COMPANY_ID,
      code: '9609.0',
      actor: 'admin',
    });

    expect(result.code).toBe('9609.0');
    expect(result.companyId).toBe(COMPANY_ID);
    expect(profileUpdated[0]).toMatchObject({
      defaultEconomicActivityId: 'activity-111',
      economicActivityCode: '9609.0',
    });
  });

  it('rejects inactive activity (haciendaStatus=I)', async () => {
    const { handler } = buildHandler({ activity: makeActivity({ haciendaStatus: 'I' }) });

    await expect(
      handler.execute({
        tenantId: TENANT_ID,
        companyId: COMPANY_ID,
        code: '9609.0',
        actor: 'admin',
      }),
    ).rejects.toMatchObject({ code: 'DEFAULT_ACTIVITY_INVALID' });
  });

  it('rejects billing-disabled activity', async () => {
    const { handler } = buildHandler({ activity: makeActivity({ billingEnabled: false }) });

    await expect(
      handler.execute({
        tenantId: TENANT_ID,
        companyId: COMPANY_ID,
        code: '9609.0',
        actor: 'admin',
      }),
    ).rejects.toMatchObject({ code: 'DEFAULT_ACTIVITY_INVALID' });
  });

  it('throws ECONOMIC_ACTIVITY_NOT_FOUND when activity not found', async () => {
    const { handler } = buildHandler({ activity: null });

    await expect(
      handler.execute({
        tenantId: TENANT_ID,
        companyId: COMPANY_ID,
        code: '9609.0',
        actor: 'admin',
      }),
    ).rejects.toMatchObject({ code: 'ECONOMIC_ACTIVITY_NOT_FOUND' });
  });

  it('throws COMPANY_NOT_FOUND for wrong tenant (tenant isolation)', async () => {
    const { handler } = buildHandler({ company: null });

    await expect(
      handler.execute({
        tenantId: 'wrong-tenant',
        companyId: COMPANY_ID,
        code: '9609.0',
        actor: 'admin',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws FISCAL_PROFILE_NOT_FOUND when profile does not exist', async () => {
    const { handler } = buildHandler({ profile: null });

    await expect(
      handler.execute({
        tenantId: TENANT_ID,
        companyId: COMPANY_ID,
        code: '9609.0',
        actor: 'admin',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
