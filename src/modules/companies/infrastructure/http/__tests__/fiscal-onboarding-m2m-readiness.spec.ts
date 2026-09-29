/**
 * fiscal-onboarding-m2m-readiness.spec.ts
 *
 * Tests for the M2M fiscal-readiness endpoint:
 *   GET /companies/:companyId/fiscal-onboarding/:environment/readiness
 *
 * Covers requirements from the CASE_B_M2M_AUTHORIZATION_GAP implementation.
 * All tests use deterministic mocks — zero real Hacienda calls, zero DB writes.
 */
import * as request from 'supertest';
import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { FiscalOnboardingM2MController } from '../taxpayer-verification.controller';
import { FiscalReadinessService } from '../../../../fiscal-documents/application/fiscal-xml/fiscal-readiness.service';
import { GetTaxpayerVerificationStatusHandler } from '../../../application/use-cases/get-taxpayer-verification/get-taxpayer-verification-status.handler';
import { VerifyCompanyTaxpayerHandler } from '../../../application/use-cases/verify-taxpayer/verify-company-taxpayer.handler';
import { ListEconomicActivitiesHandler } from '../../../application/use-cases/list-economic-activities/list-economic-activities.handler';
import { SetActivityBillingEnabledHandler } from '../../../application/use-cases/set-activity-enabled/set-activity-billing-enabled.handler';
import { SetDefaultEconomicActivityHandler } from '../../../application/use-cases/set-default-activity/set-default-economic-activity.handler';
import { ScopeGuard } from '../../../../../api/guards/scope.guard';
import { SCOPES_KEY } from '../../../../../api/decorators/scopes.decorator';
import { ApiKeyAuthGuard } from '../../../../../api/guards/api-key-auth.guard';
import { ApiKeyThrottlerGuard } from '../../../../../api/guards/api-key-throttler.guard';
import { GlobalExceptionFilter } from '../../../../../api/filters/global-exception.filter';

// ─── Fixtures ───────────────────────────────────────────────────────────────

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const COMPANY_ID = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';
const OTHER_COMPANY = 'eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee';
const ENVIRONMENT = 'SANDBOX';

const READY_RESULT = {
  companyId: COMPANY_ID,
  environment: ENVIRONMENT,
  readyToIssue: true,
  reasonCodes: [],
  warnings: [],
  checkedAt: new Date('2026-09-27T18:00:00.000Z'),
  // activeCertificate is present in FiscalReadinessResult but MUST NOT appear in M2M response
  activeCertificate: {
    id: 'cert-1',
    fingerprintSha256: 'a'.repeat(64),
    validFrom: new Date('2026-01-01'),
    validTo: new Date('2027-01-01'),
    extractedIdentityNumber: '207530251',
    extractedIdentityType: '01',
    subjectName: 'CN=Sandbox',
  },
};

// ─── Guard helpers ──────────────────────────────────────────────────────────

/** API key guard that injects a controlled tenant + scopes into the request. */
function makeMockApiKeyGuard(tenantId: string, scopes: string[]): CanActivate {
  return {
    canActivate(ctx: ExecutionContext): boolean {
      const req = ctx.switchToHttp().getRequest<Record<string, unknown>>();
      req['apiKey'] = { id: 'key-1', keyPrefix: 'test1234', scopes };
      req['user'] = { tenantId };
      return true;
    },
  };
}

const alwaysUnauthorizedGuard: CanActivate = {
  canActivate(): boolean {
    throw new UnauthorizedException({ code: 'API_KEY_INVALID', message: 'Invalid API key.' });
  },
};

const passThroughGuard: CanActivate = { canActivate: () => true };

// ─── Test-app factory ───────────────────────────────────────────────────────

async function createApp(opts: {
  readinessMock?: jest.Mock;
  statusMock?: jest.Mock;
  activitiesMock?: jest.Mock;
  verifyMock?: jest.Mock;
  setEnabledMock?: jest.Mock;
  setDefaultMock?: jest.Mock;
  guardTenantId?: string;
  guardScopes?: string[];
  useUnauthorizedGuard?: boolean;
}): Promise<INestApplication> {
  const readinessMock = opts.readinessMock ?? jest.fn().mockResolvedValue(READY_RESULT);

  const moduleRef = await Test.createTestingModule({
    controllers: [FiscalOnboardingM2MController],
    providers: [
      { provide: FiscalReadinessService, useValue: { evaluate: readinessMock } },
      {
        provide: GetTaxpayerVerificationStatusHandler,
        useValue: {
          execute:
            opts.statusMock ??
            jest.fn().mockResolvedValue({
              companyId: COMPANY_ID,
              haciendaVerificationStatus: null,
              haciendaVerifiedAt: null,
              haciendaTaxSituation: null,
              moroso: null,
              omiso: null,
              defaultEconomicActivityId: null,
              activities: [],
            }),
        },
      },
      {
        provide: VerifyCompanyTaxpayerHandler,
        useValue: {
          execute:
            opts.verifyMock ??
            jest.fn().mockResolvedValue({ companyId: COMPANY_ID, activities: [] }),
        },
      },
      {
        provide: ListEconomicActivitiesHandler,
        useValue: { execute: opts.activitiesMock ?? jest.fn().mockResolvedValue([]) },
      },
      {
        provide: SetActivityBillingEnabledHandler,
        useValue: { execute: opts.setEnabledMock ?? jest.fn() },
      },
      {
        provide: SetDefaultEconomicActivityHandler,
        useValue: { execute: opts.setDefaultMock ?? jest.fn() },
      },
      Reflector,
      ScopeGuard,
    ],
  })
    .overrideGuard(ApiKeyAuthGuard)
    .useValue(
      opts.useUnauthorizedGuard
        ? alwaysUnauthorizedGuard
        : makeMockApiKeyGuard(
            opts.guardTenantId ?? TENANT_A,
            opts.guardScopes ?? ['fiscal-onboarding:read'],
          ),
    )
    .overrideGuard(ApiKeyThrottlerGuard)
    .useValue(passThroughGuard)
    .compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  app.useGlobalFilters(new GlobalExceptionFilter());
  await app.init();
  return app;
}

function readinessUrl(companyId = COMPANY_ID, env = ENVIRONMENT): string {
  return `/companies/${companyId}/fiscal-onboarding/${env}/readiness`;
}

// ─────────────────────────────────────────────────────────────────────────────
// [1] [2] [3] Auth contract
// ─────────────────────────────────────────────────────────────────────────────

describe('FiscalOnboardingM2MController — readiness auth contract', () => {
  it('[1] valid API key + fiscal-onboarding:read → HTTP 200', async () => {
    const app = await createApp({});
    const res = await request(app.getHttpServer()).get(readinessUrl()).set('X-API-Key', 'valid');
    expect(res.status).toBe(200);
    await app.close();
  });

  it('[2] valid API key WITHOUT fiscal-onboarding:read → HTTP 403 INSUFFICIENT_SCOPE', async () => {
    const app = await createApp({ guardScopes: ['fiscal-onboarding:write'] });
    const res = await request(app.getHttpServer()).get(readinessUrl()).set('X-API-Key', 'valid');
    expect(res.status).toBe(403);
    // ScopeGuard throws ForbiddenException({ code: 'INSUFFICIENT_SCOPE', ... });
    // GlobalExceptionFilter may nest the payload — assert on serialized body
    expect(JSON.stringify(res.body)).toContain('INSUFFICIENT_SCOPE');
    await app.close();
  });

  it('[2b] API key with NO scopes at all → HTTP 403', async () => {
    const app = await createApp({ guardScopes: [] });
    const res = await request(app.getHttpServer()).get(readinessUrl()).set('X-API-Key', 'valid');
    expect(res.status).toBe(403);
    await app.close();
  });

  it('[3] authentication failure → HTTP 401', async () => {
    const app = await createApp({ useUnauthorizedGuard: true });
    const res = await request(app.getHttpServer()).get(readinessUrl());
    expect(res.status).toBe(401);
    await app.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [4] [5] Response contract — DTO fields
// ─────────────────────────────────────────────────────────────────────────────

describe('FiscalOnboardingM2MController — readiness response contract', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp({});
  });
  afterAll(() => app.close());

  it('[4a] response contains readyToIssue', async () => {
    const res = await request(app.getHttpServer()).get(readinessUrl()).set('X-API-Key', 'valid');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('readyToIssue', true);
  });

  it('[4b] response contains reasonCodes array', async () => {
    const res = await request(app.getHttpServer()).get(readinessUrl()).set('X-API-Key', 'valid');
    expect(Array.isArray(res.body.reasonCodes)).toBe(true);
  });

  it('[4c] response contains warnings array', async () => {
    const res = await request(app.getHttpServer()).get(readinessUrl()).set('X-API-Key', 'valid');
    expect(Array.isArray(res.body.warnings)).toBe(true);
  });

  it('[4d] response contains checkedAt (ISO string)', async () => {
    const res = await request(app.getHttpServer()).get(readinessUrl()).set('X-API-Key', 'valid');
    expect(res.body).toHaveProperty('checkedAt');
    expect(typeof res.body.checkedAt).toBe('string');
  });

  it('[4e] response contains environment', async () => {
    const res = await request(app.getHttpServer()).get(readinessUrl()).set('X-API-Key', 'valid');
    expect(res.body).toHaveProperty('environment', ENVIRONMENT);
  });

  it('[4f] response contains companyId', async () => {
    const res = await request(app.getHttpServer()).get(readinessUrl()).set('X-API-Key', 'valid');
    expect(res.body).toHaveProperty('companyId', COMPANY_ID);
  });

  it('[4g] activeCertificate is excluded from response — not part of FiscalReadinessResponseDto', async () => {
    const res = await request(app.getHttpServer()).get(readinessUrl()).set('X-API-Key', 'valid');
    expect(res.body).not.toHaveProperty('activeCertificate');
  });

  it('[5] fully ready company → readyToIssue=true, reasonCodes=[], warnings=[]', async () => {
    const res = await request(app.getHttpServer()).get(readinessUrl()).set('X-API-Key', 'valid');
    expect(res.body.readyToIssue).toBe(true);
    expect(res.body.reasonCodes).toHaveLength(0);
    expect(res.body.warnings).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [6] [7] [8] [23] [24] Readiness semantics
// ─────────────────────────────────────────────────────────────────────────────

describe('FiscalOnboardingM2MController — readiness semantics', () => {
  let app: INestApplication;
  let evaluateMock: jest.Mock;

  beforeAll(async () => {
    evaluateMock = jest.fn();
    app = await createApp({ readinessMock: evaluateMock });
  });
  afterAll(() => app.close());
  beforeEach(() => evaluateMock.mockReset());

  it('[6] DEFAULT_ECONOMIC_ACTIVITY_MISSING → readyToIssue=false', async () => {
    evaluateMock.mockResolvedValue({
      ...READY_RESULT,
      readyToIssue: false,
      reasonCodes: ['DEFAULT_ECONOMIC_ACTIVITY_MISSING'],
    });
    const res = await request(app.getHttpServer()).get(readinessUrl()).set('X-API-Key', 'valid');
    expect(res.body.readyToIssue).toBe(false);
    expect(res.body.reasonCodes).toContain('DEFAULT_ECONOMIC_ACTIVITY_MISSING');
  });

  it('[7] DEFAULT_ECONOMIC_ACTIVITY_INVALID → readyToIssue=false', async () => {
    evaluateMock.mockResolvedValue({
      ...READY_RESULT,
      readyToIssue: false,
      reasonCodes: ['DEFAULT_ECONOMIC_ACTIVITY_INVALID'],
    });
    const res = await request(app.getHttpServer()).get(readinessUrl()).set('X-API-Key', 'valid');
    expect(res.body.readyToIssue).toBe(false);
    expect(res.body.reasonCodes).toContain('DEFAULT_ECONOMIC_ACTIVITY_INVALID');
  });

  it('[8] CERTIFICATE_EXPIRED → readyToIssue=false', async () => {
    evaluateMock.mockResolvedValue({
      ...READY_RESULT,
      readyToIssue: false,
      reasonCodes: ['CERTIFICATE_EXPIRED'],
    });
    const res = await request(app.getHttpServer()).get(readinessUrl()).set('X-API-Key', 'valid');
    expect(res.body.readyToIssue).toBe(false);
    expect(res.body.reasonCodes).toContain('CERTIFICATE_EXPIRED');
  });

  it('[23] activity changes are reflected per request — evaluate called each time', async () => {
    evaluateMock
      .mockResolvedValueOnce({
        ...READY_RESULT,
        readyToIssue: false,
        reasonCodes: ['ECONOMIC_ACTIVITY_MISSING'],
      })
      .mockResolvedValueOnce({ ...READY_RESULT, readyToIssue: true, reasonCodes: [] });

    const res1 = await request(app.getHttpServer()).get(readinessUrl()).set('X-API-Key', 'valid');
    const res2 = await request(app.getHttpServer()).get(readinessUrl()).set('X-API-Key', 'valid');

    expect(res1.body.readyToIssue).toBe(false);
    expect(res2.body.readyToIssue).toBe(true);
    expect(evaluateMock).toHaveBeenCalledTimes(2);
  });

  it('[24] SANDBOX and PRODUCTION are passed independently to evaluate', async () => {
    evaluateMock.mockResolvedValue(READY_RESULT);

    await request(app.getHttpServer())
      .get(readinessUrl(COMPANY_ID, 'SANDBOX'))
      .set('X-API-Key', 'v');
    await request(app.getHttpServer())
      .get(readinessUrl(COMPANY_ID, 'PRODUCTION'))
      .set('X-API-Key', 'v');

    expect(evaluateMock.mock.calls[0][0].environment).toBe('SANDBOX');
    expect(evaluateMock.mock.calls[1][0].environment).toBe('PRODUCTION');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [9] [10] Cross-tenant / company isolation
// ─────────────────────────────────────────────────────────────────────────────

describe('FiscalOnboardingM2MController — cross-tenant isolation', () => {
  it('[9] tenantId comes from API key — Tenant A key always sends TENANT_A to evaluate()', async () => {
    const evaluateMock = jest.fn().mockResolvedValue(READY_RESULT);
    const app = await createApp({ readinessMock: evaluateMock, guardTenantId: TENANT_A });

    await request(app.getHttpServer()).get(readinessUrl()).set('X-API-Key', 'tenant-a-key');

    expect(evaluateMock).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_A, companyId: COMPANY_ID }),
    );
    await app.close();
  });

  it('[9b] Tenant B key injects TENANT_B — service receives TENANT_B regardless of companyId', async () => {
    const evaluateMock = jest.fn().mockResolvedValue(READY_RESULT);
    const app = await createApp({ readinessMock: evaluateMock, guardTenantId: TENANT_B });

    await request(app.getHttpServer()).get(readinessUrl()).set('X-API-Key', 'tenant-b-key');

    expect(evaluateMock).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT_B }));
    await app.close();
  });

  it('[10] companyId from URL param is forwarded to evaluate()', async () => {
    const evaluateMock = jest.fn().mockResolvedValue(READY_RESULT);
    const app = await createApp({ readinessMock: evaluateMock });

    await request(app.getHttpServer()).get(readinessUrl(OTHER_COMPANY)).set('X-API-Key', 'valid');

    expect(evaluateMock).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: OTHER_COMPANY }),
    );
    await app.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [18-22] Security — no secret material in response
// ─────────────────────────────────────────────────────────────────────────────

describe('FiscalOnboardingM2MController — response secret safety', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp({ readinessMock: jest.fn().mockResolvedValue(READY_RESULT) });
  });
  afterAll(() => app.close());

  it('[18] response does NOT contain certificateSecretReference', async () => {
    const res = await request(app.getHttpServer()).get(readinessUrl()).set('X-API-Key', 'valid');
    expect(JSON.stringify(res.body)).not.toContain('certificateSecretReference');
  });

  it('[19] response does NOT contain passwordSecretReference', async () => {
    const res = await request(app.getHttpServer()).get(readinessUrl()).set('X-API-Key', 'valid');
    expect(JSON.stringify(res.body)).not.toContain('passwordSecretReference');
  });

  it('[20] response does NOT contain raw PKCS12 / p12 bytes', async () => {
    const res = await request(app.getHttpServer()).get(readinessUrl()).set('X-API-Key', 'valid');
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('pkcs12');
    expect(body).not.toContain('"p12"');
  });

  it('[21] response does NOT contain PIN or raw password fields', async () => {
    const res = await request(app.getHttpServer()).get(readinessUrl()).set('X-API-Key', 'valid');
    const body = JSON.stringify(res.body).toLowerCase();
    expect(body).not.toContain('"pin"');
    expect(body).not.toContain('"password"');
  });

  it('[22] response does NOT contain Hacienda OAuth tokens or credentials', async () => {
    const res = await request(app.getHttpServer()).get(readinessUrl()).set('X-API-Key', 'valid');
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('haciendaPassword');
    expect(body).not.toContain('accessToken');
    expect(body).not.toContain('refreshToken');
  });

  it('[4g-security] activeCertificate safe metadata never leaks to response', async () => {
    const res = await request(app.getHttpServer()).get(readinessUrl()).set('X-API-Key', 'valid');
    expect(res.body).not.toHaveProperty('activeCertificate');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [12-17] Read-only invariant — zero mutations, zero Hacienda calls
// ─────────────────────────────────────────────────────────────────────────────

describe('FiscalOnboardingM2MController — read-only invariant', () => {
  it('[12-17] readiness calls only evaluate() — no mutations, no Hacienda verify', async () => {
    const evaluateMock = jest.fn().mockResolvedValue(READY_RESULT);
    const verifyMock = jest.fn();
    const setEnabledMock = jest.fn();
    const setDefaultMock = jest.fn();

    const app = await createApp({
      readinessMock: evaluateMock,
      verifyMock,
      setEnabledMock,
      setDefaultMock,
    });

    const res = await request(app.getHttpServer()).get(readinessUrl()).set('X-API-Key', 'valid');

    expect(res.status).toBe(200);
    // Only evaluate() was called
    expect(evaluateMock).toHaveBeenCalledTimes(1);
    // No Hacienda POST (verify), no activity mutations, no default mutations
    expect(verifyMock).not.toHaveBeenCalled();
    expect(setEnabledMock).not.toHaveBeenCalled();
    expect(setDefaultMock).not.toHaveBeenCalled();

    await app.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [11] [25] [26] [27] Regression — JWT endpoint and existing M2M routes intact
// ─────────────────────────────────────────────────────────────────────────────

describe('FiscalOnboardingM2MController — regression: existing M2M routes intact', () => {
  let app: INestApplication;
  let getStatusMock: jest.Mock;
  let listActivitiesMock: jest.Mock;

  beforeAll(async () => {
    getStatusMock = jest.fn().mockResolvedValue({
      companyId: COMPANY_ID,
      haciendaVerificationStatus: 'VERIFIED',
      haciendaVerifiedAt: new Date(),
      haciendaTaxSituation: 'Inscrito',
      moroso: false,
      omiso: false,
      defaultEconomicActivityId: null,
      activities: [],
    });
    listActivitiesMock = jest.fn().mockResolvedValue([]);
    app = await createApp({
      statusMock: getStatusMock,
      activitiesMock: listActivitiesMock,
    });
  });
  afterAll(() => app.close());

  it('[11] new readiness route does NOT interfere with GET /status route', async () => {
    const statusRes = await request(app.getHttpServer())
      .get(`/companies/${COMPANY_ID}/fiscal-onboarding/status`)
      .set('X-API-Key', 'valid');
    const readinessRes = await request(app.getHttpServer())
      .get(readinessUrl())
      .set('X-API-Key', 'valid');

    expect(statusRes.status).toBe(200);
    expect(readinessRes.status).toBe(200);
    // status does NOT have readyToIssue — they are distinct contracts
    expect(statusRes.body).not.toHaveProperty('readyToIssue');
    expect(readinessRes.body).toHaveProperty('readyToIssue');
  });

  it('[26] GET fiscal-onboarding/status still delegates to GetTaxpayerVerificationStatusHandler', async () => {
    await request(app.getHttpServer())
      .get(`/companies/${COMPANY_ID}/fiscal-onboarding/status`)
      .set('X-API-Key', 'valid');
    expect(getStatusMock).toHaveBeenCalledWith(TENANT_A, COMPANY_ID);
  });

  it('[26b] GET fiscal-onboarding/activities still works (HTTP 200)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${COMPANY_ID}/fiscal-onboarding/activities`)
      .set('X-API-Key', 'valid');
    expect(res.status).toBe(200);
    expect(listActivitiesMock).toHaveBeenCalledWith(TENANT_A, COMPANY_ID);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [27] @Scopes metadata — unit-level proof
// ─────────────────────────────────────────────────────────────────────────────

describe('FiscalOnboardingM2MController — @Scopes metadata', () => {
  it('[27] getFiscalReadiness carries fiscal-onboarding:read scope metadata', () => {
    const controller = new FiscalOnboardingM2MController(
      { execute: jest.fn() } as unknown as VerifyCompanyTaxpayerHandler,
      { execute: jest.fn() } as unknown as GetTaxpayerVerificationStatusHandler,
      { execute: jest.fn() } as unknown as ListEconomicActivitiesHandler,
      { execute: jest.fn() } as unknown as SetActivityBillingEnabledHandler,
      { execute: jest.fn() } as unknown as SetDefaultEconomicActivityHandler,
      { evaluate: jest.fn() } as unknown as FiscalReadinessService,
    );

    const scopesMeta: string[] | undefined = Reflect.getMetadata(
      SCOPES_KEY,
      Object.getPrototypeOf(controller).getFiscalReadiness,
    );
    expect(scopesMeta).toContain('fiscal-onboarding:read');
  });

  it('[25] existing readiness service tests are not affected — FiscalReadinessService is injected unchanged', () => {
    // The existence of FiscalReadinessService as a standalone injectable is verified
    // by its own test suite (fiscal-readiness.service.spec.ts — 23 tests).
    // This assertion confirms the controller uses it via injection, not re-implementation.
    const controller = new FiscalOnboardingM2MController(
      { execute: jest.fn() } as unknown as VerifyCompanyTaxpayerHandler,
      { execute: jest.fn() } as unknown as GetTaxpayerVerificationStatusHandler,
      { execute: jest.fn() } as unknown as ListEconomicActivitiesHandler,
      { execute: jest.fn() } as unknown as SetActivityBillingEnabledHandler,
      { execute: jest.fn() } as unknown as SetDefaultEconomicActivityHandler,
      { evaluate: jest.fn() } as unknown as FiscalReadinessService,
    );
    expect(controller).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(typeof (controller as any).readiness.evaluate).toBe('function');
  });
});
