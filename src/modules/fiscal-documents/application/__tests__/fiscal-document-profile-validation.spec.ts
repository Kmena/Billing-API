/**
 * Regression tests for FiscalDocumentService.getReadyCompanyFiscalProfile()
 *
 * Covered behaviors:
 *   - proveedorSistemas is optional: null or absent does NOT block fiscal profile completeness.
 *   - proveedorSistemas present continues to work (regression guard).
 *   - No fabricated proveedorSistemas value is injected: null is returned as null.
 *   - All genuinely required fields (economicActivityCode, province, canton, district,
 *     otrasSenas, email) still fail completeness when absent.
 *   - Missing profile row still fails with COMPANY_FISCAL_PROFILE_REQUIRED.
 *
 * Test boundary: private method tested via (service as any) without full createDocument stack.
 * Prisma and AuditService are minimal mocks -- only companyFiscalProfile.findFirst is exercised.
 */
import { BadRequestException } from '@nestjs/common';
import { FiscalDocumentService } from '../fiscal-document.service';

// --- Stable test identifiers ---

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const COMPANY_ID = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';

// --- Helpers ---

/** Builds a minimal valid fiscal profile with all required fields present and proveedorSistemas null. */
function buildProfile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'cccccccc-cccc-4ccc-cccc-cccccccccccc',
    tenantId: TENANT_ID,
    companyId: COMPANY_ID,
    economicActivityCode: '620200',
    proveedorSistemas: null,
    province: '1',
    canton: '01',
    district: '01',
    barrio: null,
    otrasSenas: 'Avenida central, edificio de prueba',
    email: 'test@example.co.cr',
    phoneCountryCode: null,
    phoneNumber: null,
    ...overrides,
  };
}

/** Creates a transaction mock that returns the given profile from findFirst. */
function makeTx(profile: Record<string, unknown> | null) {
  return {
    companyFiscalProfile: {
      findFirst: jest.fn().mockResolvedValue(profile),
    },
  };
}

/** Creates a minimal FiscalDocumentService with only the dependencies required for the test. */
function buildService(): FiscalDocumentService {
  const prisma = {} as never;
  const auditService = { record: jest.fn() } as never;
  return new FiscalDocumentService(prisma, auditService);
}

/** Asserts the rejection carries the given error code in its response. */
async function expectProfileError(action: Promise<unknown>, expectedCode: string): Promise<void> {
  try {
    await action;
    throw new Error('Expected action to throw ' + expectedCode + ' but it resolved');
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toMatchObject({ code: expectedCode });
  }
}

// --- Tests ---

describe('FiscalDocumentService -- fiscal profile completeness validation', () => {
  // -- optional field: proveedorSistemas ---

  it('considers a fiscal profile complete when proveedorSistemas is null', async () => {
    const service = buildService();
    const tx = makeTx(buildProfile({ proveedorSistemas: null }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (service as any).getReadyCompanyFiscalProfile(tx, TENANT_ID, COMPANY_ID);

    expect(result).toBeDefined();
  });

  it('considers a fiscal profile complete when proveedorSistemas is undefined', async () => {
    const service = buildService();
    const profileWithoutField = buildProfile();
    delete (profileWithoutField as Record<string, unknown>).proveedorSistemas;
    const tx = makeTx(profileWithoutField);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (service as any).getReadyCompanyFiscalProfile(tx, TENANT_ID, COMPANY_ID);

    expect(result).toBeDefined();
  });

  it('considers a fiscal profile complete when proveedorSistemas is present (regression guard)', async () => {
    const service = buildService();
    const tx = makeTx(buildProfile({ proveedorSistemas: '3101234567' }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (service as any).getReadyCompanyFiscalProfile(tx, TENANT_ID, COMPANY_ID);

    expect(result).toBeDefined();
    expect(result.proveedorSistemas).toBe('3101234567');
  });

  it('does not fabricate a proveedorSistemas value -- null in profile is null in returned result', async () => {
    const service = buildService();
    const tx = makeTx(buildProfile({ proveedorSistemas: null }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (service as any).getReadyCompanyFiscalProfile(tx, TENANT_ID, COMPANY_ID);

    // The field must be null -- never a fabricated placeholder such as empty-string BILLING UNKNOWN etc.
    expect(result.proveedorSistemas).toBeNull();
  });

  // -- missing profile row ---

  it('throws COMPANY_FISCAL_PROFILE_REQUIRED when no profile row exists', async () => {
    const service = buildService();
    const tx = makeTx(null);

    await expectProfileError(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any).getReadyCompanyFiscalProfile(tx, TENANT_ID, COMPANY_ID),
      'COMPANY_FISCAL_PROFILE_REQUIRED',
    );
  });

  // -- genuinely required fields still enforced ---

  it.each([
    ['economicActivityCode', { economicActivityCode: null }],
    ['province', { province: null }],
    ['canton', { canton: null }],
    ['district', { district: null }],
    ['otrasSenas', { otrasSenas: null }],
    ['email', { email: null }],
    ['economicActivityCode (empty string)', { economicActivityCode: '' }],
    ['otrasSenas (whitespace only)', { otrasSenas: '   ' }],
  ])(
    'throws COMPANY_FISCAL_PROFILE_INCOMPLETE when required field %s is absent',
    async (_label, override) => {
      const service = buildService();
      const tx = makeTx(buildProfile(override));

      await expectProfileError(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (service as any).getReadyCompanyFiscalProfile(tx, TENANT_ID, COMPANY_ID),
        'COMPANY_FISCAL_PROFILE_INCOMPLETE',
      );
    },
  );

  it('does not throw for whitespace-only proveedorSistemas (optional field)', async () => {
    // proveedorSistemas is stored as-is from the DB; whitespace trim is done at upsert time.
    // Profile validation must not reject a whitespace proveedorSistemas since it is optional.
    const service = buildService();
    const tx = makeTx(buildProfile({ proveedorSistemas: '   ' }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (service as any).getReadyCompanyFiscalProfile(tx, TENANT_ID, COMPANY_ID);

    expect(result).toBeDefined();
  });
});
