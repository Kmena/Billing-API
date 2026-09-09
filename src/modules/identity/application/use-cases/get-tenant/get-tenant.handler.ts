import { Inject, Injectable } from '@nestjs/common';
import { ITenantRepository, TENANT_REPOSITORY } from '../../../domain/ports/tenant.repository';
import { TenantNotFoundException } from '../../../domain/exceptions/tenant-not-found.exception';
import { GetTenantQuery } from './get-tenant.query';
import { GetTenantResult } from './get-tenant.result';

@Injectable()
export class GetTenantHandler {
  constructor(
    @Inject(TENANT_REPOSITORY)
    private readonly tenantRepository: ITenantRepository,
  ) {}

  async execute(query: GetTenantQuery): Promise<GetTenantResult> {
    const tenant = await this.tenantRepository.findById(query.id);

    if (!tenant) {
      throw new TenantNotFoundException(query.id);
    }

    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      status: tenant.status,
      plan: tenant.plan,
      createdAt: tenant.createdAt,
      updatedAt: tenant.updatedAt,
    };
  }
}
