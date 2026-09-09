import { Inject, Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { Tenant } from '../../../domain/entities/tenant.entity';
import { ITenantRepository, TENANT_REPOSITORY } from '../../../domain/ports/tenant.repository';
import { TenantSlugAlreadyExistsException } from '../../../domain/exceptions/tenant-slug-already-exists.exception';
import { TenantSlug } from '../../../domain/value-objects/tenant-slug.vo';
import { CreateTenantCommand } from './create-tenant.command';
import { CreateTenantResult } from './create-tenant.result';

@Injectable()
export class CreateTenantHandler {
  constructor(
    @Inject(TENANT_REPOSITORY)
    private readonly tenantRepository: ITenantRepository,
  ) {}

  async execute(command: CreateTenantCommand): Promise<CreateTenantResult> {
    // Determine slug (generate from name if not provided)
    const slug = command.slug
      ? TenantSlug.create(command.slug).value
      : TenantSlug.fromName(command.name).value;

    // Check uniqueness
    const existing = await this.tenantRepository.findBySlug(slug);
    if (existing) {
      throw new TenantSlugAlreadyExistsException(slug);
    }

    const tenant = Tenant.create(uuidv4(), command.name, slug, command.correlationId);

    await this.tenantRepository.save(tenant);

    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      status: tenant.status,
      plan: tenant.plan,
      createdAt: tenant.createdAt,
    };
  }
}
