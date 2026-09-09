import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import { ITenantRepository } from '../../domain/ports/tenant.repository';
import { Tenant } from '../../domain/entities/tenant.entity';
import type { Tenant as PrismaTenant } from '@prisma/client';

@Injectable()
export class PrismaTenantRepository implements ITenantRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<Tenant | null> {
    const record = await this.prisma.tenant.findUnique({ where: { id } });
    if (!record) return null;
    return this.toDomain(record);
  }

  async findBySlug(slug: string): Promise<Tenant | null> {
    const record = await this.prisma.tenant.findUnique({ where: { slug } });
    if (!record) return null;
    return this.toDomain(record);
  }

  async save(tenant: Tenant): Promise<void> {
    await this.prisma.tenant.upsert({
      where: { id: tenant.id },
      create: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        status: tenant.status,
        plan: tenant.plan,
        metadata: (tenant.metadata as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        createdAt: tenant.createdAt,
        updatedAt: tenant.updatedAt,
      },
      update: {
        name: tenant.name,
        status: tenant.status,
        updatedAt: tenant.updatedAt,
      },
    });
  }

  private toDomain(record: PrismaTenant): Tenant {
    return Tenant.reconstruct({
      id: record.id,
      name: record.name,
      slug: record.slug,
      status: record.status,
      plan: record.plan,
      metadata: record.metadata as Record<string, unknown> | null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  }
}
