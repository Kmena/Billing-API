import { Tenant } from '../entities/tenant.entity';

export interface ITenantRepository {
  findById(id: string): Promise<Tenant | null>;
  findBySlug(slug: string): Promise<Tenant | null>;
  save(tenant: Tenant): Promise<void>;
}

export const TENANT_REPOSITORY = Symbol('ITenantRepository');
