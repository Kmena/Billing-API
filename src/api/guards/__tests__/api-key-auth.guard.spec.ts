import { ExecutionContext, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ApiKeyAuthGuard } from '../api-key-auth.guard';
import { ApiKey } from '../../../modules/api-keys/domain/entities/api-key.entity';
import { BILLING_CONSUMER_V2_PROFILE } from '../../../modules/fiscal-consumers/domain/consumer-v2.policy';

const apiKey = (environment: 'TEST' | 'LIVE', integrationProfile?: string) =>
  ApiKey.reconstruct({
    id: '00000000-0000-0000-0000-000000000001',
    tenantId: '00000000-0000-0000-0000-000000000010',
    name: 'wave-1-test-key',
    environment,
    keyPrefix: 'wave1001',
    keyHash: 'not-used-by-this-guard-test',
    scopes: ['invoices:write'],
    integrationProfile,
    status: 'ACTIVE',
    createdAt: new Date('2026-10-09T00:00:00.000Z'),
    updatedAt: new Date('2026-10-09T00:00:00.000Z'),
  });

function contextFor(input: {
  params?: Record<string, string>;
  body?: Record<string, unknown>;
  originalUrl?: string;
}) {
  const request = {
    headers: { 'x-api-key': 'bk_test_wave1001_not-a-real-secret' },
    params: input.params ?? {},
    body: input.body,
    originalUrl: input.originalUrl,
    user: undefined as { tenantId: string } | undefined,
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

describe('ApiKeyAuthGuard fiscal authorization policy', () => {
  const validateApiKeyHandler = { execute: jest.fn() };
  const prisma = { company: { findFirst: jest.fn() } };
  const guard = new ApiKeyAuthGuard(validateApiKeyHandler as never, prisma as never);

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.company.findFirst.mockImplementation(
      (args: { where?: { authorizedApiKeys?: unknown } }) =>
        Promise.resolve(
          args.where?.authorizedApiKeys
            ? { id: '00000000-0000-0000-0000-000000000020' }
            : {
                id: '00000000-0000-0000-0000-000000000020',
                tenantId: '00000000-0000-0000-0000-000000000010',
              },
        ),
    );
  });

  it.each([
    ['TEST', 'SANDBOX'],
    ['LIVE', 'PRODUCTION'],
  ] as const)('allows %s keys in %s', async (keyEnvironment, fiscalEnvironment) => {
    validateApiKeyHandler.execute.mockResolvedValue({ apiKey: apiKey(keyEnvironment) });
    const { context, request } = contextFor({
      params: { companyId: '00000000-0000-0000-0000-000000000020', environment: fiscalEnvironment },
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({ tenantId: '00000000-0000-0000-0000-000000000010' });
  });

  it.each([
    ['TEST', 'PRODUCTION'],
    ['LIVE', 'SANDBOX'],
  ] as const)(
    'rejects %s keys in %s before a controller runs',
    async (keyEnvironment, fiscalEnvironment) => {
      validateApiKeyHandler.execute.mockResolvedValue({ apiKey: apiKey(keyEnvironment) });
      const { context } = contextFor({
        params: {
          companyId: '00000000-0000-0000-0000-000000000020',
          environment: fiscalEnvironment,
        },
      });

      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
    },
  );

  it('rejects an unassigned company in the authenticated tenant', async () => {
    validateApiKeyHandler.execute.mockResolvedValue({ apiKey: apiKey('TEST') });
    prisma.company.findFirst.mockResolvedValueOnce({
      id: '00000000-0000-0000-0000-000000000099',
      tenantId: '00000000-0000-0000-0000-000000000010',
    });
    prisma.company.findFirst.mockResolvedValueOnce(null);
    const { context } = contextFor({
      body: {
        companyId: '00000000-0000-0000-0000-000000000099',
        environment: 'SANDBOX',
      },
    });

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'API_KEY_COMPANY_NOT_AUTHORIZED' }),
    });
  });

  it('preserves lookup not-found semantics for another tenant without authenticating it as local', async () => {
    validateApiKeyHandler.execute.mockResolvedValue({ apiKey: apiKey('TEST') });
    prisma.company.findFirst.mockResolvedValueOnce({
      id: '00000000-0000-0000-0000-000000000099',
      tenantId: '00000000-0000-0000-0000-000000000777',
    });
    const { context } = contextFor({
      params: { companyId: '00000000-0000-0000-0000-000000000099', environment: 'SANDBOX' },
      originalUrl: '/api/v1/companies/x/fiscal-documents/SANDBOX/identity-by-idempotency',
    });

    const activation = guard.canActivate(context);
    await expect(activation).rejects.toBeInstanceOf(NotFoundException);
    await expect(activation).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'FISCAL_IDENTITY_NOT_FOUND' }),
    });
  });

  it.each([
    '/api/v1/companies/x/fiscal-documents/SANDBOX/invoices',
    '/api/v1/fiscal-documents/document-id',
  ])('rejects a v2 profile on legacy route %s before company lookup', async (originalUrl) => {
    validateApiKeyHandler.execute.mockResolvedValue({
      apiKey: apiKey('TEST', BILLING_CONSUMER_V2_PROFILE),
    });
    const { context, request } = contextFor({ originalUrl });

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'INTEGRATION_PROFILE_NOT_AUTHORIZED' }),
    });
    expect(prisma.company.findFirst).not.toHaveBeenCalled();
    expect(request.user).toBeUndefined();
  });

  it('continues to allow the existing Inventori profile', async () => {
    validateApiKeyHandler.execute.mockResolvedValue({
      apiKey: apiKey('TEST', 'inventori-fiscal-v1'),
    });
    const { context } = contextFor({
      params: { companyId: '00000000-0000-0000-0000-000000000020', environment: 'SANDBOX' },
      originalUrl: '/api/v1/companies/x/fiscal-documents/SANDBOX/invoices',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });
});
