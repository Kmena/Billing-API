import * as request from 'supertest';
import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
  ValidationPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ScopeGuard } from '../../../../../api/guards/scope.guard';
import { ApiKeyAuthGuard } from '../../../../../api/guards/api-key-auth.guard';
import { ApiKeyThrottlerGuard } from '../../../../../api/guards/api-key-throttler.guard';
import { GlobalExceptionFilter } from '../../../../../api/filters/global-exception.filter';
import { PrismaService } from '../../../../../infrastructure/database/prisma.service';
import { GetCompanyHandler } from '../../../../companies/application/use-cases/get-company/get-company.handler';
import { ConfigureConnectionHandler } from '../../../application/use-cases/configure-connection/configure-connection.handler';
import { ValidateConnectionHandler } from '../../../application/use-cases/validate-connection/validate-connection.handler';
import { HaciendaCredentialsM2MController } from '../hacienda-credentials-m2m.controller';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const API_KEY_ID = 'api-key-id';
const COMPANY_A = 'company-a';
const COMPANY_B = 'company-b';

const CONNECTION = {
  id: 'connection-id',
  tenantId: TENANT_A,
  companyId: COMPANY_A,
  environment: 'SANDBOX',
  status: 'PENDING_VALIDATION',
  lastValidatedAt: null,
  lastSuccessfulAuthAt: null,
  lastValidationErrorCode: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

function makeMockApiKeyGuard(tenantId: string, scopes: string[]): CanActivate {
  return {
    canActivate(ctx: ExecutionContext): boolean {
      const req = ctx.switchToHttp().getRequest<Record<string, unknown>>();
      req['apiKey'] = { id: API_KEY_ID, tenantId, keyPrefix: 'test1234', scopes };
      req['user'] = { tenantId };
      return true;
    },
  };
}

const unauthorizedGuard: CanActivate = {
  canActivate(): boolean {
    throw new UnauthorizedException({ code: 'API_KEY_INVALID' });
  },
};
const passThroughGuard: CanActivate = { canActivate: () => true };

async function createApp(opts: {
  scopes?: string[];
  tenantId?: string;
  unauthorized?: boolean;
  bindingFound?: boolean;
  getCompanyRejects?: boolean;
  configureMock?: jest.Mock;
  validateMock?: jest.Mock;
}): Promise<{ app: INestApplication; configureMock: jest.Mock; validateMock: jest.Mock }> {
  const configureMock = opts.configureMock ?? jest.fn().mockResolvedValue(CONNECTION);
  const validateMock =
    opts.validateMock ?? jest.fn().mockResolvedValue({ ...CONNECTION, status: 'CONNECTED' });

  const moduleRef = await Test.createTestingModule({
    controllers: [HaciendaCredentialsM2MController],
    providers: [
      {
        provide: GetCompanyHandler,
        useValue: {
          execute: opts.getCompanyRejects
            ? jest.fn().mockRejectedValue(new NotFoundException({ code: 'COMPANY_NOT_FOUND' }))
            : jest.fn().mockResolvedValue({ id: COMPANY_A, tenantId: opts.tenantId ?? TENANT_A }),
        },
      },
      {
        provide: PrismaService,
        useValue: {
          apiKeyCompany: {
            findUnique: jest
              .fn()
              .mockResolvedValue(
                opts.bindingFound === false ? null : { apiKeyId: API_KEY_ID, companyId: COMPANY_A },
              ),
          },
        },
      },
      { provide: ConfigureConnectionHandler, useValue: { execute: configureMock } },
      { provide: ValidateConnectionHandler, useValue: { execute: validateMock } },
      Reflector,
      ScopeGuard,
    ],
  })
    .overrideGuard(ApiKeyAuthGuard)
    .useValue(
      opts.unauthorized
        ? unauthorizedGuard
        : makeMockApiKeyGuard(
            opts.tenantId ?? TENANT_A,
            opts.scopes ?? ['fiscal-credentials:write'],
          ),
    )
    .overrideGuard(ApiKeyThrottlerGuard)
    .useValue(passThroughGuard)
    .compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter());
  await app.init();
  return { app, configureMock, validateMock };
}

function configureUrl(companyId = COMPANY_A, env = 'SANDBOX'): string {
  return `/companies/${companyId}/fiscal-onboarding/${env}/hacienda-credentials`;
}
function validateUrl(companyId = COMPANY_A, env = 'SANDBOX'): string {
  return `${configureUrl(companyId, env)}/validate`;
}

describe('HaciendaCredentialsM2MController', () => {
  it('denies missing/invalid API key', async () => {
    const { app } = await createApp({ unauthorized: true });
    const res = await request(app.getHttpServer()).put(configureUrl()).send({ username: 'u' });
    expect(res.status).toBe(401);
    await app.close();
  });

  it.each([
    ['no credential-write scope', ['fiscal-onboarding:read']],
    ['readiness scope alone', ['fiscal-onboarding:read']],
    ['activity-management scope alone', ['fiscal-onboarding:write']],
  ])('denies configure with %s', async (_label, scopes) => {
    const { app } = await createApp({ scopes });
    const res = await request(app.getHttpServer()).put(configureUrl()).send({ username: 'u' });
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toContain('INSUFFICIENT_SCOPE');
    await app.close();
  });

  it('allows configure with fiscal-credentials:write and safe response only', async () => {
    const { app, configureMock } = await createApp({ scopes: ['fiscal-credentials:write'] });
    const res = await request(app.getHttpServer())
      .put(configureUrl())
      .send({ username: 'opaque-user', password: 'opaque-password' });

    expect(res.status).toBe(200);
    expect(configureMock).toHaveBeenCalledWith({
      tenantId: TENANT_A,
      companyId: COMPANY_A,
      environment: 'SANDBOX',
      username: 'opaque-user',
      password: 'opaque-password',
    });
    expect(JSON.stringify(res.body)).not.toContain('opaque-password');
    expect(res.body).not.toHaveProperty('username');
    expect(res.body).not.toHaveProperty('password');
    expect(res.body).not.toHaveProperty('secretReference');
    await app.close();
  });

  it('validation requires fiscal-credentials:validate', async () => {
    const denied = await createApp({ scopes: ['fiscal-credentials:write'] });
    const deniedRes = await request(denied.app.getHttpServer()).post(validateUrl()).send();
    expect(deniedRes.status).toBe(403);
    await denied.app.close();

    const allowed = await createApp({ scopes: ['fiscal-credentials:validate'] });
    const ok = await request(allowed.app.getHttpServer()).post(validateUrl()).send();
    expect(ok.status).toBe(200);
    expect(allowed.validateMock).toHaveBeenCalledWith(TENANT_A, COMPANY_A, 'SANDBOX');
    expect(ok.body.status).toBe('CONNECTED');
    expect(JSON.stringify(ok.body)).not.toMatch(
      /password|access_token|refresh_token|secretReference/i,
    );
    await allowed.app.close();
  });

  it('enforces tenant and ApiKeyCompany isolation before configure', async () => {
    const crossTenant = await createApp({ tenantId: TENANT_B, getCompanyRejects: true });
    const crossTenantRes = await request(crossTenant.app.getHttpServer())
      .put(configureUrl(COMPANY_B))
      .send({ username: 'u' });
    expect(crossTenantRes.status).toBe(404);
    await crossTenant.app.close();

    const noBinding = await createApp({ bindingFound: false });
    const noBindingRes = await request(noBinding.app.getHttpServer())
      .put(configureUrl())
      .send({ username: 'u' });
    expect(noBindingRes.status).toBe(403);
    expect(JSON.stringify(noBindingRes.body)).toContain('API_KEY_COMPANY_NOT_AUTHORIZED');
    await noBinding.app.close();
  });

  it('rejects body attempts to override tenant, company, environment, provider URL, or secret reference', async () => {
    const { app, configureMock } = await createApp({ scopes: ['fiscal-credentials:write'] });
    const res = await request(app.getHttpServer()).put(configureUrl()).send({
      username: 'u',
      tenantId: 'evil-tenant',
      companyId: 'evil-company',
      environment: 'PRODUCTION',
      secretReference: 'evil/ref',
      tokenUrl: 'https://evil.example/token',
      providerUrl: 'https://evil.example',
    });
    expect(res.status).toBe(400);
    expect(configureMock).not.toHaveBeenCalled();
    await app.close();
  });

  it.each([
    ['username-only', { username: 'new-user' }],
    ['password-only', { password: 'new-password' }],
    ['both-fields', { username: 'new-user', password: 'new-password' }],
  ])('delegates %s update to ConfigureConnectionHandler', async (_label, body) => {
    const { app, configureMock } = await createApp({ scopes: ['fiscal-credentials:write'] });
    const res = await request(app.getHttpServer()).put(configureUrl()).send(body);
    expect(res.status).toBe(200);
    expect(configureMock).toHaveBeenCalledWith(expect.objectContaining(body));
    await app.close();
  });

  it('empty update is rejected by existing ConfigureConnectionHandler semantics', async () => {
    const configureMock = jest
      .fn()
      .mockRejectedValue(
        new UnprocessableEntityException({ code: 'HACIENDA_CONNECTION_INSUFFICIENT_CREDENTIALS' }),
      );
    const { app } = await createApp({ scopes: ['fiscal-credentials:write'], configureMock });
    const res = await request(app.getHttpServer()).put(configureUrl()).send({});
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).not.toMatch(/password|secret|token/i);
    await app.close();
  });

  it('uses route environment only and rejects arbitrary environment strings', async () => {
    const { app, configureMock } = await createApp({ scopes: ['fiscal-credentials:write'] });
    const ok = await request(app.getHttpServer())
      .put(configureUrl(COMPANY_A, 'PRODUCTION'))
      .send({ username: 'u' });
    expect(ok.status).toBe(200);
    expect(configureMock).toHaveBeenCalledWith(
      expect.objectContaining({ environment: 'PRODUCTION' }),
    );

    const bad = await request(app.getHttpServer())
      .put(configureUrl(COMPANY_A, 'DEV'))
      .send({ username: 'u' });
    expect(bad.status).toBe(400);
    await app.close();
  });
});
