import { Tenant } from '../entities/tenant.entity';
import { TenantCreatedEvent } from '../events/tenant-created.event';

describe('Tenant entity', () => {
  describe('Tenant.create()', () => {
    it('creates a tenant with valid name and auto-generated slug', () => {
      const tenant = Tenant.create('tenant-id-1', 'Acme Corporation');

      expect(tenant.id).toBe('tenant-id-1');
      expect(tenant.name).toBe('Acme Corporation');
      expect(tenant.slug).toBe('acme-corporation');
      expect(tenant.status).toBe('ACTIVE');
      expect(tenant.plan).toBe('TRIAL');
    });

    it('creates a tenant with explicit slug', () => {
      const tenant = Tenant.create('tenant-id-2', 'My Company', 'my-company');

      expect(tenant.slug).toBe('my-company');
    });

    it('emits TenantCreatedEvent upon creation', () => {
      const tenant = Tenant.create('tenant-id-3', 'Acme Corp');

      const events = tenant.domainEvents;
      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(TenantCreatedEvent);
    });

    it('starts with ACTIVE status', () => {
      const tenant = Tenant.create('tenant-id-4', 'Active Company');
      expect(tenant.status).toBe('ACTIVE');
    });

    it('starts with TRIAL plan', () => {
      const tenant = Tenant.create('tenant-id-5', 'Trial Company');
      expect(tenant.plan).toBe('TRIAL');
    });
  });

  describe('TenantSlug invariants', () => {
    it('throws when name is too short to generate a valid slug', () => {
      expect(() => Tenant.create('id', 'A')).toThrow();
    });
  });

  describe('status transitions', () => {
    it('can be suspended', () => {
      const tenant = Tenant.create('tenant-id-6', 'Test Company');
      tenant.suspend();
      expect(tenant.status).toBe('SUSPENDED');
    });

    it('can be reactivated after suspension', () => {
      const tenant = Tenant.create('tenant-id-7', 'Test Company');
      tenant.suspend();
      tenant.activate();
      expect(tenant.status).toBe('ACTIVE');
    });
  });

  describe('Tenant.reconstruct()', () => {
    it('reconstructs a tenant without emitting events', () => {
      const now = new Date();
      const tenant = Tenant.reconstruct({
        id: 'reconstructed-id',
        name: 'Reconstructed Corp',
        slug: 'reconstructed-corp',
        status: 'ACTIVE',
        plan: 'STARTER',
        metadata: null,
        createdAt: now,
        updatedAt: now,
      });

      expect(tenant.id).toBe('reconstructed-id');
      expect(tenant.slug).toBe('reconstructed-corp');
      expect(tenant.domainEvents).toHaveLength(0);
    });
  });
});
