import { GetTenantHandler } from '../use-cases/get-tenant/get-tenant.handler';
import { ITenantRepository } from '../../domain/ports/tenant.repository';
import { Tenant } from '../../domain/entities/tenant.entity';
import { TenantNotFoundException } from '../../domain/exceptions/tenant-not-found.exception';

describe('GetTenantHandler', () => {
  let handler: GetTenantHandler;
  let mockRepository: jest.Mocked<ITenantRepository>;

  beforeEach(() => {
    mockRepository = {
      findById: jest.fn(),
      findBySlug: jest.fn(),
      save: jest.fn(),
    };

    handler = new GetTenantHandler(mockRepository);
  });

  function buildTenant(id: string): Tenant {
    return Tenant.reconstruct({
      id,
      name: 'Acme Corporation',
      slug: `tenant-${id}`,
      status: 'ACTIVE',
      plan: 'TRIAL',
      metadata: null,
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      updatedAt: new Date('2025-01-02T00:00:00.000Z'),
    });
  }

  describe('execute()', () => {
    it('returns tenant when id matches authenticatedTenantId', async () => {
      const tenant = buildTenant('tenant-a');
      mockRepository.findById.mockResolvedValue(tenant);

      const result = await handler.execute({
        id: 'tenant-a',
        authenticatedTenantId: 'tenant-a',
      });

      expect(result.id).toBe('tenant-a');
      expect(result.name).toBe('Acme Corporation');
      expect(result.status).toBe('ACTIVE');
      expect(mockRepository.findById).toHaveBeenCalledWith('tenant-a');
    });

    it('throws TenantNotFoundException when id does not match authenticatedTenantId', async () => {
      const tenant = buildTenant('tenant-b');
      mockRepository.findById.mockResolvedValue(tenant);

      await expect(
        handler.execute({
          id: 'tenant-b',
          authenticatedTenantId: 'tenant-a',
        }),
      ).rejects.toThrow(TenantNotFoundException);

      expect(mockRepository.findById).toHaveBeenCalledWith('tenant-b');
    });

    it('throws TenantNotFoundException when tenant does not exist', async () => {
      mockRepository.findById.mockResolvedValue(null);

      await expect(
        handler.execute({
          id: 'missing-tenant',
          authenticatedTenantId: 'tenant-a',
        }),
      ).rejects.toThrow(TenantNotFoundException);

      expect(mockRepository.findById).toHaveBeenCalledWith('missing-tenant');
    });
  });
});
