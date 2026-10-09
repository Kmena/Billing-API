import { ForbiddenException } from '@nestjs/common';
import { ApiKeysController } from '../api-keys.controller';

const admin = { userId: 'user-1', tenantId: 'tenant-1', role: 'TENANT_ADMIN' };
const member = { userId: 'user-2', tenantId: 'tenant-1', role: 'MEMBER' };

function createController() {
  const create = {
    execute: jest.fn().mockResolvedValue({
      id: 'key-1',
      name: 'Inventori',
      environment: 'TEST',
      keyPrefix: 'safe',
      secret: 'never-assert-secret',
      scopes: ['invoices:read'],
      status: 'ACTIVE',
      createdAt: new Date(),
    }),
  };
  const list = { execute: jest.fn().mockResolvedValue([]) };
  const revoke = { execute: jest.fn().mockResolvedValue(undefined) };
  const assign = { execute: jest.fn().mockResolvedValue({ created: true }) };
  const audit = { record: jest.fn() };
  return {
    controller: new ApiKeysController(
      create as never,
      list as never,
      revoke as never,
      assign as never,
      audit as never,
    ),
    create,
    list,
    revoke,
    assign,
    audit,
  };
}

describe('ApiKeysController administration boundary', () => {
  it('rejects non-admin key creation before invoking the creation handler', async () => {
    const { controller, create } = createController();
    await expect(
      controller.createApiKey({ user: member }, { name: 'x', environment: 'TEST', scopes: [] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(create.execute).not.toHaveBeenCalled();
  });

  it('records a safe audit event after an administrator creates a key', async () => {
    const { controller, audit } = createController();
    await controller.createApiKey(
      { user: admin },
      { name: 'Inventori', environment: 'TEST', scopes: ['invoices:read'] },
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'api-key.created',
        apiKeyId: 'key-1',
        actor: 'user-1',
        metadata: { environment: 'TEST', scopeCount: 1 },
      }),
    );
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain('never-assert-secret');
  });

  it('rejects non-admin company binding before invoking the authorization handler', async () => {
    const { controller, assign } = createController();
    await expect(
      controller.assignCompany({ user: member }, 'key-1', {
        companyId: '00000000-0000-0000-0000-000000000001',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(assign.execute).not.toHaveBeenCalled();
  });

  it('passes only the authenticated tenant to the company binding handler and audits it', async () => {
    const { controller, assign, audit } = createController();
    await expect(
      controller.assignCompany({ user: admin }, 'key-1', {
        companyId: '00000000-0000-0000-0000-000000000001',
      }),
    ).resolves.toEqual({ created: true });
    expect(assign.execute).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      apiKeyId: 'key-1',
      companyId: '00000000-0000-0000-0000-000000000001',
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'api-key.company-authorized',
        apiKeyId: 'key-1',
        companyId: '00000000-0000-0000-0000-000000000001',
      }),
    );
  });
});
