import { CreateTenantHandler } from '../use-cases/create-tenant/create-tenant.handler';
import { ITenantRepository } from '../../domain/ports/tenant.repository';
import { TenantSlugAlreadyExistsException } from '../../domain/exceptions/tenant-slug-already-exists.exception';
import { Tenant } from '../../domain/entities/tenant.entity';

describe('CreateTenantHandler', () => {
  let handler: CreateTenantHandler;
  let mockRepository: jest.Mocked<ITenantRepository>;

  beforeEach(() => {
    mockRepository = {
      findById: jest.fn(),
      findBySlug: jest.fn(),
      save: jest.fn(),
    };

    handler = new CreateTenantHandler(mockRepository);
  });

  describe('execute()', () => {
    it('creates a tenant successfully with a generated slug', async () => {
      mockRepository.findBySlug.mockResolvedValue(null);
      mockRepository.save.mockResolvedValue(undefined);

      const result = await handler.execute({ name: 'Acme Corporation' });

      expect(result.name).toBe('Acme Corporation');
      expect(result.slug).toBe('acme-corporation');
      expect(result.status).toBe('ACTIVE');
      expect(result.plan).toBe('TRIAL');
      expect(result.id).toBeDefined();
      expect(mockRepository.save).toHaveBeenCalledTimes(1);
    });

    it('creates a tenant successfully with an explicit slug', async () => {
      mockRepository.findBySlug.mockResolvedValue(null);
      mockRepository.save.mockResolvedValue(undefined);

      const result = await handler.execute({ name: 'My Company', slug: 'my-custom-slug' });

      expect(result.slug).toBe('my-custom-slug');
    });

    it('throws TenantSlugAlreadyExistsException when slug already exists', async () => {
      const existingTenant = Tenant.reconstruct({
        id: 'existing-id',
        name: 'Existing Corp',
        slug: 'acme-corporation',
        status: 'ACTIVE',
        plan: 'TRIAL',
        metadata: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockRepository.findBySlug.mockResolvedValue(existingTenant);

      await expect(handler.execute({ name: 'Acme Corporation' })).rejects.toThrow(
        TenantSlugAlreadyExistsException,
      );
      expect(mockRepository.save).not.toHaveBeenCalled();
    });

    it('checks slug uniqueness before saving', async () => {
      mockRepository.findBySlug.mockResolvedValue(null);
      mockRepository.save.mockResolvedValue(undefined);

      await handler.execute({ name: 'Test Company', slug: 'test-company' });

      expect(mockRepository.findBySlug).toHaveBeenCalledWith('test-company');
    });
  });
});
