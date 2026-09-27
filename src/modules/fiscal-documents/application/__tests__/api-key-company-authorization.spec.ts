/**
 * API Key Company Authorization Tests — PRE-TASK-016 authorization preparation.
 *
 * Proves the ApiKeyCompany authorization model without creating FiscalDocuments.
 *
 * Execution order in createDocument():
 *   1. validateCreateCommand()   — sync, pre-transaction (throws if command invalid)
 *   2. prisma.$transaction() runs:
 *        a. company.findFirst()          → COMPANY_NOT_FOUND if null
 *        b. apiKeyCompany.findUnique()   → API_KEY_COMPANY_NOT_AUTHORIZED if null
 *        c. getReadyCompanyFiscalProfile → COMPANY_FISCAL_PROFILE_REQUIRED if null
 *        d. reserveIdempotencyKey        → ...
 *        e. sequence allocation, document.create, ...
 *
 * Tests prove auth is enforced at step 2a–2b BEFORE any fiscal mutation (2e).
 * Tests A2/A3/D1/D2/D3 provide a valid command so step 1 passes and
 * the transaction is entered — then auth throws before any mutation.
 *
 * Sources of truth:
 *   fiscal-document.service.ts:523 — validateCreateCommand (apiKeyId + idempotency required)
 *   fiscal-document.service.ts:238 — ApiKeyCompany check in createDocument()
 *   fiscal-document.service.ts:211 — ApiKeyCompany check in getDocument()
 *   scope.guard.ts                 — ScopeGuard AND semantics
 *
 * Safety invariants:
 *   - No fiscalDocument.create called for auth-failure tests
 *   - No $queryRaw sequence allocation for auth-failure tests
 *   - Hacienda counters: 0
 *   - Consecutives consumed: 0
 */

import { ForbiddenException } from '@nestjs/common';
import { FiscalDocumentService } from '../fiscal-document.service';
import { ScopeGuard } from '../../../../api/guards/scope.guard';
import { Reflector } from '@nestjs/core';

// ─── Constants matching bootstrap ──────────────────────────────────────────────
const TENANT_ID = '25ae538c-b272-407b-83d0-ccc78be3c658';
const COMPANY_ID = 'dde91f44-6ceb-4eb7-b322-0139919cc34d';
const API_KEY_ID = 'c255f9ff-3c9d-4665-8718-5c4467ae427a';
const OTHER_COMPANY = 'aaaaaaaa-0000-4000-8000-000000000001';
const OTHER_TENANT = 'bbbbbbbb-0000-4000-8000-000000000002';
const OTHER_KEY = 'dddddddd-0000-4000-8000-000000000001';
const ENV = 'SANDBOX' as const;

// ─── Fully valid command — passes validateCreateCommand so transaction is entered ─
// idempotencyKey and receiver are required by validateCreateCommand (pre-transaction).
// Auth checks happen INSIDE the transaction, after these pass.
const VALID_COMMAND = {
  tenantId: TENANT_ID,
  companyId: COMPANY_ID,
  environment: ENV,
  type: 'INVOICE' as const,
  currency: 'CRC',
  saleCondition: '01',
  paymentMethod: '01',
  idempotencyKey: 'test-auth-idem-001',
  receiver: {
    name: 'Test Receiver SA',
    identificationType: '02', // Juridica
    identificationNumber: '312345678', // valid numeric ≤12 digits
    email: 'receiver@test.com',
  },
  lines: [
    {
      lineNumber: 1,
      cabysCode: '4219000000000', // 13-digit CABYS code (valid format)
      description: 'Test item',
      unitMeasure: 'Unid',
      quantity: '1',
      unitPrice: '1000',
    },
  ],
  apiKeyId: API_KEY_ID,
  actor: 'apiKey:8c3323eb',
};

// ─── Prisma mock builders ────────────────────────────────────────────────────

type CompanyRow = {
  id: string;
  tenantId: string;
  identificationNumber: string;
  identificationType: string;
  legalName: string;
  status: string;
  tradeName: string | null;
} | null;

function makeCompanyRow(id = COMPANY_ID, tenantId = TENANT_ID): NonNullable<CompanyRow> {
  return {
    id,
    tenantId,
    identificationNumber: '207530251',
    identificationType: 'FISICA',
    legalName: 'PERSONA FISICA SANDBOX',
    status: 'ACTIVE',
    tradeName: null,
  };
}

function makeBindingRow(apiKeyId = API_KEY_ID, companyId = COMPANY_ID) {
  return { apiKeyId, companyId };
}

/**
 * Build a Prisma mock where:
 * - tx.company.findFirst  → companyRow (null = not found)
 * - tx.apiKeyCompany.findUnique → bindingRow (null = not authorized)
 * All deeper ops (profile, sequence, document.create) are left unimplemented
 * so they implicitly return undefined → will throw COMPANY_FISCAL_PROFILE_REQUIRED
 * (proof that auth was passed).
 */
function makePrisma(
  opts: {
    companyRow?: CompanyRow;
    bindingRow?: object | null;
  } = {},
) {
  const companyRow: CompanyRow = opts.companyRow !== undefined ? opts.companyRow : makeCompanyRow();
  const bindingRow: object | null =
    opts.bindingRow !== undefined ? opts.bindingRow : makeBindingRow();

  const txObj = {
    company: { findFirst: jest.fn().mockResolvedValue(companyRow) },
    apiKeyCompany: { findUnique: jest.fn().mockResolvedValue(bindingRow) },
    companyFiscalProfile: { findFirst: jest.fn().mockResolvedValue(null) },
    companyEconomicActivity: { findUnique: jest.fn().mockResolvedValue(null) },
    fiscalIdempotencyKey: { findUnique: jest.fn().mockResolvedValue(null) },
    haciendaConnection: { findFirst: jest.fn().mockResolvedValue(null) },
    fiscalIssuancePoint: { findFirst: jest.fn().mockResolvedValue(null) },
    fiscalDocument: { create: jest.fn(), findUnique: jest.fn() },
    $queryRaw: jest.fn(),
  };

  return {
    company: { findFirst: jest.fn().mockResolvedValue(companyRow) },
    apiKeyCompany: { findUnique: jest.fn().mockResolvedValue(bindingRow) },
    $transaction: jest
      .fn()
      .mockImplementation((fn: (tx: typeof txObj) => Promise<unknown>) => fn(txObj)),
    _txObj: txObj,
  };
}

function makeService(prisma: ReturnType<typeof makePrisma>) {
  return new FiscalDocumentService(prisma as never, { record: jest.fn() } as never);
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite A: createDocument — ApiKeyCompany authorization
// ─────────────────────────────────────────────────────────────────────────────

describe('createDocument — ApiKeyCompany authorization (PRE-TASK-016)', () => {
  it('A1: intended Company is authorized — passes auth, fails only at downstream profile', async () => {
    // binding present → auth passes → next error is COMPANY_FISCAL_PROFILE_REQUIRED (not auth)
    const prisma = makePrisma({ bindingRow: makeBindingRow() });
    const service = makeService(prisma);

    await expect(service.createDocument(VALID_COMMAND)).rejects.toMatchObject({
      response: { code: 'COMPANY_FISCAL_PROFILE_REQUIRED' },
    });
    // Prove the tx ran and company was looked up
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('A2: unrelated Company → binding absent → 403 API_KEY_COMPANY_NOT_AUTHORIZED', async () => {
    const prisma = makePrisma({ bindingRow: null });
    const service = makeService(prisma);

    await expect(
      service.createDocument({ ...VALID_COMMAND, companyId: OTHER_COMPANY }),
    ).rejects.toMatchObject({ response: { code: 'API_KEY_COMPANY_NOT_AUTHORIZED' } });

    // Prove the transaction was entered (company found, then binding check threw)
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // Prove document.create was NOT called
    expect(prisma._txObj.fiscalDocument.create).not.toHaveBeenCalled();
  });

  it('A3: wrong tenant → company not found → NotFoundException before binding check', async () => {
    const prisma = makePrisma({ companyRow: null });
    const service = makeService(prisma);

    await expect(
      service.createDocument({ ...VALID_COMMAND, tenantId: OTHER_TENANT }),
    ).rejects.toMatchObject({ response: { code: 'COMPANY_NOT_FOUND' } });

    // COMPANY_NOT_FOUND is thrown before ApiKeyCompany check
    expect(prisma._txObj.apiKeyCompany.findUnique).not.toHaveBeenCalled();
  });

  it('A4: command without apiKeyId → API_KEY_CONTEXT_REQUIRED (pre-transaction guard)', async () => {
    // validateCreateCommand throws API_KEY_CONTEXT_REQUIRED before any transaction
    const prisma = makePrisma({ bindingRow: null });
    const service = makeService(prisma);

    await expect(
      service.createDocument({ ...VALID_COMMAND, apiKeyId: undefined }),
    ).rejects.toMatchObject({ response: { code: 'API_KEY_CONTEXT_REQUIRED' } });

    // Transaction should NOT have been entered
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('A5: missing idempotencyKey → IDEMPOTENCY_KEY_REQUIRED (pre-transaction guard)', async () => {
    // Proves idempotencyKey is required even for auth-failing commands
    const prisma = makePrisma({ bindingRow: null });
    const service = makeService(prisma);

    await expect(
      service.createDocument({ ...VALID_COMMAND, idempotencyKey: undefined }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_KEY_REQUIRED' } });

    // Transaction should NOT have been entered
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('A6: same binding → idempotent retry with different idempotencyKey still requires binding', async () => {
    // Prove that idempotency key rotation doesn't bypass auth
    const prisma = makePrisma({ bindingRow: null });
    const service = makeService(prisma);

    // Two different keys, both fail with API_KEY_COMPANY_NOT_AUTHORIZED
    await expect(
      service.createDocument({ ...VALID_COMMAND, idempotencyKey: 'retry-001' }),
    ).rejects.toMatchObject({ response: { code: 'API_KEY_COMPANY_NOT_AUTHORIZED' } });

    await expect(
      service.createDocument({ ...VALID_COMMAND, idempotencyKey: 'retry-002' }),
    ).rejects.toMatchObject({ response: { code: 'API_KEY_COMPANY_NOT_AUTHORIZED' } });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite B: getDocument — ApiKeyCompany authorization
// ─────────────────────────────────────────────────────────────────────────────

describe('getDocument — ApiKeyCompany authorization (PRE-TASK-016)', () => {
  function makeGetPrisma(opts: { docFound?: boolean; bindingFound?: boolean } = {}) {
    const doc =
      opts.docFound !== false
        ? { id: 'doc-1', tenantId: TENANT_ID, companyId: COMPANY_ID, type: 'INVOICE' }
        : null;
    const binding =
      opts.bindingFound !== false ? { apiKeyId: API_KEY_ID, companyId: COMPANY_ID } : null;
    return {
      fiscalDocument: { findFirst: jest.fn().mockResolvedValue(doc) },
      apiKeyCompany: { findUnique: jest.fn().mockResolvedValue(binding) },
    };
  }

  it('B1: missing invoices:read scope → INSUFFICIENT_SCOPE (scope check before binding)', async () => {
    const prisma = makeGetPrisma();
    const service = new FiscalDocumentService(prisma as never, { record: jest.fn() } as never);

    await expect(
      service.getDocument({
        tenantId: TENANT_ID,
        documentId: 'doc-1',
        apiKeyId: API_KEY_ID,
        scopes: ['tickets:read'],
      }),
    ).rejects.toMatchObject({ response: { code: 'INSUFFICIENT_SCOPE' } });

    // Binding check was NOT reached
    expect(prisma.apiKeyCompany.findUnique).not.toHaveBeenCalled();
  });

  it('B2: correct scope but binding absent → API_KEY_COMPANY_NOT_AUTHORIZED', async () => {
    const prisma = makeGetPrisma({ bindingFound: false });
    const service = new FiscalDocumentService(prisma as never, { record: jest.fn() } as never);

    await expect(
      service.getDocument({
        tenantId: TENANT_ID,
        documentId: 'doc-1',
        apiKeyId: API_KEY_ID,
        scopes: ['invoices:read'],
      }),
    ).rejects.toMatchObject({ response: { code: 'API_KEY_COMPANY_NOT_AUTHORIZED' } });
  });

  it('B3: document not found → FISCAL_DOCUMENT_NOT_FOUND (tenant isolation)', async () => {
    const prisma = makeGetPrisma({ docFound: false });
    const service = new FiscalDocumentService(prisma as never, { record: jest.fn() } as never);

    await expect(
      service.getDocument({
        tenantId: OTHER_TENANT,
        documentId: 'doc-1',
        apiKeyId: API_KEY_ID,
        scopes: ['invoices:read'],
      }),
    ).rejects.toMatchObject({ response: { code: 'FISCAL_DOCUMENT_NOT_FOUND' } });

    // Binding was NOT checked (doc not found first)
    expect(prisma.apiKeyCompany.findUnique).not.toHaveBeenCalled();
  });

  it('B4: correct scope + binding present → proceeds (no 403)', async () => {
    const prisma = {
      fiscalDocument: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'doc-1',
          tenantId: TENANT_ID,
          companyId: COMPANY_ID,
          type: 'INVOICE',
          status: 'READY_FOR_XML',
          environment: 'SANDBOX',
          clave: '50601012500310112345600100001010000000001100000001',
          consecutive: '00100001010000000001',
          securityCode: '12345678',
          issueDate: new Date(),
          issuerSnapshot: '{}',
          receiverSnapshot: null,
          currency: 'CRC',
          exchangeRate: null,
          saleCondition: '01',
          creditTermDays: null,
          paymentMethod: '01',
          lines: '[]',
          totals: '{}',
          branchCode: '001',
          terminalCode: '00001',
          situation: '1',
          sequenceValue: 1n,
          idempotencyKey: null,
          requestHash: null,
          issuancePointId: 'ip-1',
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      },
      apiKeyCompany: {
        findUnique: jest.fn().mockResolvedValue({ apiKeyId: API_KEY_ID, companyId: COMPANY_ID }),
      },
    };
    const service = new FiscalDocumentService(prisma as never, { record: jest.fn() } as never);

    const result = await service.getDocument({
      tenantId: TENANT_ID,
      documentId: 'doc-1',
      apiKeyId: API_KEY_ID,
      scopes: ['invoices:read'],
    });
    expect(result).toBeDefined();
    expect(result).not.toHaveProperty('securityCode'); // security code stripped from response
  });

  it('B5: tickets:write scope but doc is INVOICE → INSUFFICIENT_SCOPE (wrong scope type)', async () => {
    const prisma = makeGetPrisma();
    const service = new FiscalDocumentService(prisma as never, { record: jest.fn() } as never);

    // tickets:write is wrong — invoices:read is required for INVOICE documents
    await expect(
      service.getDocument({
        tenantId: TENANT_ID,
        documentId: 'doc-1',
        apiKeyId: API_KEY_ID,
        scopes: ['tickets:write'],
      }),
    ).rejects.toMatchObject({ response: { code: 'INSUFFICIENT_SCOPE' } });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite C: ScopeGuard — scope enforcement
// ─────────────────────────────────────────────────────────────────────────────

describe('ScopeGuard — scope enforcement (PRE-TASK-016)', () => {
  function makeContext(required: string[], keyScopes: string[]) {
    const reflector = new Reflector();
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(required);
    const guard = new ScopeGuard(reflector);
    const ctx = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({
          apiKey: { scopes: keyScopes, id: API_KEY_ID, keyPrefix: '8c3323eb' },
        }),
      }),
    } as never;
    return { guard, ctx };
  }

  it('C1: invoices:write scope present → allows', () => {
    const { guard, ctx } = makeContext(
      ['invoices:write'],
      [
        'taxpayers:read',
        'invoices:write',
        'invoices:read',
        'fiscal-onboarding:read',
        'fiscal-onboarding:write',
      ],
    );
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('C2: invoices:write scope ABSENT → ForbiddenException INSUFFICIENT_SCOPE', () => {
    const { guard, ctx } = makeContext(
      ['invoices:write'],
      ['taxpayers:read', 'fiscal-onboarding:read'],
    );
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('C3: fiscal-onboarding:read present → allows', () => {
    const { guard, ctx } = makeContext(
      ['fiscal-onboarding:read'],
      ['fiscal-onboarding:read', 'fiscal-onboarding:write'],
    );
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('C4: fiscal-onboarding:write present → allows', () => {
    const { guard, ctx } = makeContext(
      ['fiscal-onboarding:write'],
      ['fiscal-onboarding:read', 'fiscal-onboarding:write'],
    );
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('C5: ALL Inventori M2M scopes present → full scope set passes all required checks', () => {
    const fullScopes = [
      'taxpayers:read',
      'cabys:read',
      'exchange-rates:read',
      'fiscal-onboarding:read',
      'fiscal-onboarding:write',
      'invoices:read',
      'invoices:write',
      'tickets:read',
      'tickets:write',
    ];
    // Test each required scope individually with full scope set
    for (const required of fullScopes) {
      const { guard, ctx } = makeContext([required], fullScopes);
      expect(guard.canActivate(ctx)).toBe(true);
    }
  });

  it('C6: empty required scopes → passes regardless of key scopes', () => {
    const { guard, ctx } = makeContext([], []);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('C7: no API key present but scopes required → ForbiddenException fail-closed', () => {
    const reflector = new Reflector();
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['invoices:write']);
    const guard = new ScopeGuard(reflector);
    const ctx = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ apiKey: undefined }) }),
    } as never;
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('C8: tickets:write present but invoices:write required → DENY (AND semantics)', () => {
    const { guard, ctx } = makeContext(['invoices:write'], ['tickets:write', 'tickets:read']);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite D: Authorization invariants — cross-cutting
// ─────────────────────────────────────────────────────────────────────────────

describe('Authorization invariants — cross-cutting (PRE-TASK-016)', () => {
  it('D1: binding check inside tx — document.create NOT called on auth failure', async () => {
    const prisma = makePrisma({ bindingRow: null });
    const service = makeService(prisma);

    await expect(service.createDocument(VALID_COMMAND)).rejects.toMatchObject({
      response: { code: 'API_KEY_COMPANY_NOT_AUTHORIZED' },
    });

    // Transaction entered, company found, then binding threw — document.create not reached
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma._txObj.fiscalDocument.create).not.toHaveBeenCalled();
    // Sequence $queryRaw was NOT called
    expect(prisma._txObj.$queryRaw).not.toHaveBeenCalled();
  });

  it('D2: wrong tenant → COMPANY_NOT_FOUND (binding check not reached)', async () => {
    const prisma = makePrisma({ companyRow: null });
    const service = makeService(prisma);

    await expect(
      service.createDocument({ ...VALID_COMMAND, tenantId: 'wrong-tenant' }),
    ).rejects.toMatchObject({ response: { code: 'COMPANY_NOT_FOUND' } });

    // ApiKeyCompany check was NOT reached
    expect(prisma._txObj.apiKeyCompany.findUnique).not.toHaveBeenCalled();
    // Document was NOT created
    expect(prisma._txObj.fiscalDocument.create).not.toHaveBeenCalled();
  });

  it('D3: binding is PER-KEY+PER-COMPANY — wrong key rejected, right key passes auth', async () => {
    // Simulate: only API_KEY_ID is bound; OTHER_KEY is not
    let txCalled = 0;
    const companyRow = makeCompanyRow();
    const prisma = {
      company: { findFirst: jest.fn().mockResolvedValue(companyRow) },
      apiKeyCompany: { findUnique: jest.fn() },
      $transaction: jest
        .fn()
        .mockImplementation((fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
          const txObj = {
            company: { findFirst: jest.fn().mockResolvedValue(companyRow) },
            apiKeyCompany: {
              findUnique: jest
                .fn()
                .mockImplementation(
                  (args: { where: { apiKeyId_companyId: { apiKeyId: string } } }) => {
                    const { apiKeyId } = args.where.apiKeyId_companyId;
                    return Promise.resolve(apiKeyId === API_KEY_ID ? makeBindingRow() : null);
                  },
                ),
            },
            companyFiscalProfile: { findFirst: jest.fn().mockResolvedValue(null) },
            companyEconomicActivity: { findUnique: jest.fn() },
            $queryRaw: jest.fn(),
            fiscalDocument: { create: jest.fn() },
          };
          txCalled++;
          return fn(txObj as never);
        }),
    };
    const service = new FiscalDocumentService(prisma as never, { record: jest.fn() } as never);

    // Correct key → binding found → proceeds to downstream error (profile missing)
    await expect(service.createDocument(VALID_COMMAND)).rejects.toMatchObject({
      response: { code: 'COMPANY_FISCAL_PROFILE_REQUIRED' }, // auth passed, profile not found
    });

    // Wrong key → binding not found → 403
    await expect(
      service.createDocument({ ...VALID_COMMAND, apiKeyId: OTHER_KEY }),
    ).rejects.toMatchObject({ response: { code: 'API_KEY_COMPANY_NOT_AUTHORIZED' } });

    expect(txCalled).toBe(2); // both entered the transaction
  });

  it('D4: binding check requires BOTH key AND company to match (composite key)', async () => {
    // Simulate binding exists for (API_KEY_ID, COMPANY_ID) but NOT (API_KEY_ID, OTHER_COMPANY)
    const companyRow = makeCompanyRow();
    const txObj = {
      company: { findFirst: jest.fn().mockResolvedValue(companyRow) },
      apiKeyCompany: {
        findUnique: jest
          .fn()
          .mockImplementation(
            (args: { where: { apiKeyId_companyId: { apiKeyId: string; companyId: string } } }) => {
              const { apiKeyId, companyId } = args.where.apiKeyId_companyId;
              return Promise.resolve(
                apiKeyId === API_KEY_ID && companyId === COMPANY_ID ? makeBindingRow() : null,
              );
            },
          ),
      },
      companyFiscalProfile: { findFirst: jest.fn().mockResolvedValue(null) },
      companyEconomicActivity: { findUnique: jest.fn() },
      $queryRaw: jest.fn(),
      fiscalDocument: { create: jest.fn() },
    };
    const prisma = {
      $transaction: jest
        .fn()
        .mockImplementation((fn: (tx: typeof txObj) => Promise<unknown>) => fn(txObj)),
    };
    const service = new FiscalDocumentService(prisma as never, { record: jest.fn() } as never);

    // Right company → binding found → passes auth
    await expect(service.createDocument(VALID_COMMAND)).rejects.toMatchObject({
      response: { code: 'COMPANY_FISCAL_PROFILE_REQUIRED' }, // auth passed
    });

    // Different company ID → binding NOT found → 403
    await expect(
      service.createDocument({ ...VALID_COMMAND, companyId: OTHER_COMPANY }),
    ).rejects.toMatchObject({ response: { code: 'API_KEY_COMPANY_NOT_AUTHORIZED' } });
  });
});
