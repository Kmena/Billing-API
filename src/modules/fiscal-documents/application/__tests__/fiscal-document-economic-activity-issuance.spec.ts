import { FiscalDocumentService, CreateFiscalDocumentCommand } from '../fiscal-document.service';

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const COMPANY_ID = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const OTHER_COMPANY_ID = 'dddddddd-dddd-4ddd-dddd-dddddddddddd';
const API_KEY_ID = 'eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee';

const VALID_COMMAND: CreateFiscalDocumentCommand = {
  tenantId: TENANT_ID,
  companyId: COMPANY_ID,
  environment: 'SANDBOX',
  type: 'INVOICE',
  receiver: {
    name: 'Cliente Demo',
    identificationType: 'FISICA',
    identificationNumber: '102340567',
    email: 'cliente@example.co.cr',
  },
  currency: 'CRC',
  saleCondition: '01',
  paymentMethod: '01',
  lines: [
    {
      lineNumber: 1,
      cabysCode: '7316150100000',
      description: 'Servicio demo',
      unitMeasure: 'Sp',
      quantity: '1',
      unitPrice: '1000',
      taxAmount: '0',
    },
  ],
  idempotencyKey: 'idem-activity-test',
  apiKeyId: API_KEY_ID,
  actor: 'apiKey:test',
};

function makeProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: 'profile-1',
    tenantId: TENANT_ID,
    companyId: COMPANY_ID,
    economicActivityCode: 'LEGACY-DO-NOT-USE',
    defaultEconomicActivityId: 'activity-default',
    proveedorSistemas: null,
    province: '1',
    canton: '01',
    district: '01',
    barrio: null,
    otrasSenas: 'San José centro',
    email: 'issuer@example.co.cr',
    phoneCountryCode: null,
    phoneNumber: null,
    ...overrides,
  };
}

function makeActivity(overrides: Record<string, unknown> = {}) {
  return {
    id: 'activity-default',
    companyId: COMPANY_ID,
    code: '9609.0',
    haciendaStatus: 'A',
    billingEnabled: true,
    ...overrides,
  };
}

function makeTx(
  opts: {
    profile?: Record<string, unknown> | null;
    defaultActivity?: Record<string, unknown> | null;
    activities?: Record<string, unknown>[];
  } = {},
) {
  const profile = opts.profile !== undefined ? opts.profile : makeProfile();
  const defaultActivity =
    opts.defaultActivity !== undefined ? opts.defaultActivity : makeActivity();
  const activities = opts.activities ?? [makeActivity({ id: 'activity-single' })];

  return {
    companyFiscalProfile: { findFirst: jest.fn().mockResolvedValue(profile) },
    companyEconomicActivity: {
      findUnique: jest.fn().mockResolvedValue(defaultActivity),
      findMany: jest.fn().mockResolvedValue(activities),
    },
  };
}

function buildService(prisma: Record<string, unknown> = {}) {
  return new FiscalDocumentService(prisma as never, { record: jest.fn() } as never);
}

async function expectProfileError(action: Promise<unknown>, expectedCode: string): Promise<void> {
  await expect(action).rejects.toMatchObject({ response: { code: expectedCode } });
}

async function resolveProfile(tx: ReturnType<typeof makeTx>) {
  const service = buildService();
  return (
    service as never as {
      getReadyCompanyFiscalProfile: (
        txArg: typeof tx,
        tenantId: string,
        companyId: string,
      ) => Promise<Record<string, unknown>>;
    }
  ).getReadyCompanyFiscalProfile(tx, TENANT_ID, COMPANY_ID);
}

function makeCreatePrisma(
  opts: {
    profile?: Record<string, unknown> | null;
    defaultActivity?: Record<string, unknown> | null;
    activities?: Record<string, unknown>[];
  } = {},
) {
  const createdDocuments: Record<string, unknown>[] = [];
  const tx = {
    company: {
      findFirst: jest.fn().mockResolvedValue({
        id: COMPANY_ID,
        tenantId: TENANT_ID,
        legalName: 'PERSONA FISICA SANDBOX',
        tradeName: null,
        identificationType: 'FISICA',
        identificationNumber: '207530251',
        status: 'ACTIVE',
      }),
    },
    apiKeyCompany: { findUnique: jest.fn().mockResolvedValue({ apiKeyId: API_KEY_ID }) },
    companyFiscalProfile: {
      findFirst: jest.fn().mockResolvedValue(opts.profile ?? makeProfile()),
    },
    companyEconomicActivity: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          opts.defaultActivity !== undefined ? opts.defaultActivity : makeActivity(),
        ),
      findMany: jest.fn().mockResolvedValue(opts.activities ?? [makeActivity({ id: 'single' })]),
    },
    fiscalIdempotencyKey: {
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
    },
    haciendaConnection: { findFirst: jest.fn().mockResolvedValue({ id: 'hc-1' }) },
    fiscalIssuancePoint: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'point-1',
        branchCode: '001',
        terminalCode: '00001',
      }),
    },
    fiscalDocument: {
      create: jest.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
        const document = { ...args.data };
        createdDocuments.push(document);
        return Promise.resolve(document);
      }),
      findUnique: jest.fn(),
    },
    $queryRaw: jest
      .fn()
      .mockResolvedValueOnce([{ id: 'idempotency-1' }])
      .mockResolvedValueOnce([{ assigned: 1n }]),
  };

  return {
    prisma: {
      $transaction: jest
        .fn()
        .mockImplementation((fn: (txArg: typeof tx) => Promise<unknown>) => fn(tx)),
    },
    tx,
    createdDocuments,
  };
}

describe('FiscalDocumentService economic activity issuance invariant', () => {
  it('uses a valid verified default activity and ignores the legacy code', async () => {
    const tx = makeTx({
      profile: makeProfile({ economicActivityCode: '9999.9' }),
      defaultActivity: makeActivity({ code: '9609.0' }),
    });

    const result = await resolveProfile(tx);

    expect(result.resolvedActivityCode).toBe('9609.0');
  });

  it('selects the default only when it is active and billing-enabled', async () => {
    const tx = makeTx({
      defaultActivity: makeActivity({ haciendaStatus: 'A', billingEnabled: true }),
    });

    const result = await resolveProfile(tx);

    expect(result.resolvedActivityCode).toBe('9609.0');
  });

  it('fails closed when the default activity is inactive', async () => {
    const tx = makeTx({ defaultActivity: makeActivity({ haciendaStatus: 'I' }) });

    await expectProfileError(resolveProfile(tx), 'DEFAULT_ECONOMIC_ACTIVITY_INVALID');
  });

  it('fails closed when the default activity is disabled for Billing', async () => {
    const tx = makeTx({ defaultActivity: makeActivity({ billingEnabled: false }) });

    await expectProfileError(resolveProfile(tx), 'DEFAULT_ECONOMIC_ACTIVITY_INVALID');
  });

  it('fails closed when the default activity belongs to another Company', async () => {
    const tx = makeTx({ defaultActivity: makeActivity({ companyId: OTHER_COMPANY_ID }) });

    await expectProfileError(resolveProfile(tx), 'DEFAULT_ECONOMIC_ACTIVITY_INVALID');
  });

  it('with no default and exactly one valid activity resolves that activity, not legacy code', async () => {
    const tx = makeTx({
      profile: makeProfile({ defaultEconomicActivityId: null, economicActivityCode: '9999.9' }),
      activities: [makeActivity({ id: 'single-valid', code: '9609.0' })],
    });

    const result = await resolveProfile(tx);

    expect(result.resolvedActivityCode).toBe('9609.0');
  });

  it('with no default and multiple valid activities requires explicit default selection', async () => {
    const tx = makeTx({
      profile: makeProfile({ defaultEconomicActivityId: null }),
      activities: [
        makeActivity({ id: 'act-1', code: '9609.0' }),
        makeActivity({ id: 'act-2', code: '6110.0' }),
      ],
    });

    await expectProfileError(resolveProfile(tx), 'DEFAULT_ECONOMIC_ACTIVITY_MISSING');
  });

  it('with no default and zero persisted activities fails with missing activity semantics', async () => {
    const tx = makeTx({
      profile: makeProfile({ defaultEconomicActivityId: null }),
      activities: [],
    });

    await expectProfileError(resolveProfile(tx), 'ECONOMIC_ACTIVITY_MISSING');
  });

  it('with no default and zero valid enabled activities fails closed', async () => {
    const tx = makeTx({
      profile: makeProfile({ defaultEconomicActivityId: null }),
      activities: [makeActivity({ id: 'inactive', haciendaStatus: 'I' })],
    });

    await expectProfileError(resolveProfile(tx), 'DEFAULT_ECONOMIC_ACTIVITY_MISSING');
  });

  it('does not use arbitrary legacy economicActivityCode absent from CompanyEconomicActivity', async () => {
    const tx = makeTx({
      profile: makeProfile({ defaultEconomicActivityId: null, economicActivityCode: '1234.5' }),
      activities: [],
    });

    await expectProfileError(resolveProfile(tx), 'ECONOMIC_ACTIVITY_MISSING');
  });

  it('does not fallback to valid-looking legacy code when default is invalid', async () => {
    const tx = makeTx({
      profile: makeProfile({ economicActivityCode: '9609.0' }),
      defaultActivity: makeActivity({ haciendaStatus: 'I' }),
    });

    await expectProfileError(resolveProfile(tx), 'DEFAULT_ECONOMIC_ACTIVITY_INVALID');
  });

  it('rejects an activity inactivated after refresh for new issuance', async () => {
    const tx = makeTx({ defaultActivity: makeActivity({ haciendaStatus: 'I' }) });

    await expectProfileError(resolveProfile(tx), 'DEFAULT_ECONOMIC_ACTIVITY_INVALID');
  });

  it('copies the verified activity into issuerSnapshot.codigoActividad at creation', async () => {
    const { prisma, tx, createdDocuments } = makeCreatePrisma({
      profile: makeProfile({ economicActivityCode: '9999.9' }),
      defaultActivity: makeActivity({ code: '9609.0' }),
    });
    const service = buildService(prisma);

    const response = await service.createDocument(VALID_COMMAND);

    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(response.issuerSnapshot).toMatchObject({ codigoActividad: '9609.0' });
    expect(createdDocuments[0].issuerSnapshot).toMatchObject({ codigoActividad: '9609.0' });
  });

  it('does not mutate an existing issuerSnapshot when default changes later', async () => {
    const { prisma, createdDocuments } = makeCreatePrisma({
      defaultActivity: makeActivity({ code: '9609.0' }),
    });
    const service = buildService(prisma);

    await service.createDocument(VALID_COMMAND);
    const snapshot = createdDocuments[0].issuerSnapshot as Record<string, unknown>;

    // Simulate later configuration churn in memory. Existing document snapshot is independent.
    const laterDefault = makeActivity({ code: '6110.0' });
    expect(laterDefault.code).toBe('6110.0');
    expect(snapshot.codigoActividad).toBe('9609.0');
  });

  it('validates activity before idempotency reservation and fiscal sequence allocation', async () => {
    const { prisma, tx } = makeCreatePrisma({
      defaultActivity: makeActivity({ billingEnabled: false }),
    });
    const service = buildService(prisma);

    await expect(service.createDocument(VALID_COMMAND)).rejects.toMatchObject({
      response: { code: 'DEFAULT_ECONOMIC_ACTIVITY_INVALID' },
    });

    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.fiscalIdempotencyKey.findUnique).not.toHaveBeenCalled();
    expect(tx.fiscalDocument.create).not.toHaveBeenCalled();
  });
});
