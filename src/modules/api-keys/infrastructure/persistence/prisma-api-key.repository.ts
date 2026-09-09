import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import { TenantAwarePrismaRepository } from '../../../../infrastructure/database/tenant-aware-prisma.repository';
import { IApiKeyRepository } from '../../domain/ports/api-key.repository';
import { ApiKey } from '../../domain/entities/api-key.entity';
import type { ApiKey as PrismaApiKey } from '@prisma/client';

@Injectable()
export class PrismaApiKeyRepository
  extends TenantAwarePrismaRepository
  implements IApiKeyRepository
{
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async findById(id: string): Promise<ApiKey | null> {
    const record = await this.prisma.apiKey.findFirst({
      where: this.applyTenantFilter({ id }),
    });
    if (!record) return null;
    return this.toDomain(record);
  }

  async findByPrefix(keyPrefix: string): Promise<ApiKey | null> {
    // Lookup by prefix (plaintext) — tenant filter not required here
    // because prefix is globally unique and we validate tenantId downstream
    const record = await this.prisma.apiKey.findUnique({ where: { keyPrefix } });
    if (!record) return null;
    return this.toDomain(record);
  }

  async findAllForTenant(tenantId: string): Promise<ApiKey[]> {
    const records = await this.prisma.apiKey.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
    return records.map((r) => this.toDomain(r));
  }

  async save(apiKey: ApiKey): Promise<void> {
    await this.prisma.apiKey.upsert({
      where: { id: apiKey.id },
      create: {
        id: apiKey.id,
        tenantId: apiKey.tenantId,
        name: apiKey.name,
        environment: apiKey.environment,
        keyPrefix: apiKey.keyPrefix,
        keyHash: apiKey.keyHash,
        scopes: apiKey.scopes,
        status: apiKey.status,
        expiresAt: apiKey.expiresAt,
        lastUsedAt: apiKey.lastUsedAt,
        revokedAt: apiKey.revokedAt,
        revokedBy: apiKey.revokedBy,
        createdAt: apiKey.createdAt,
        updatedAt: apiKey.updatedAt,
      },
      update: {
        status: apiKey.status,
        lastUsedAt: apiKey.lastUsedAt,
        revokedAt: apiKey.revokedAt,
        revokedBy: apiKey.revokedBy,
        updatedAt: apiKey.updatedAt,
      },
    });
  }

  private toDomain(record: PrismaApiKey): ApiKey {
    return ApiKey.reconstruct({
      id: record.id,
      tenantId: record.tenantId,
      name: record.name,
      environment: record.environment,
      keyPrefix: record.keyPrefix,
      keyHash: record.keyHash,
      scopes: record.scopes,
      status: record.status,
      expiresAt: record.expiresAt,
      lastUsedAt: record.lastUsedAt,
      revokedAt: record.revokedAt,
      revokedBy: record.revokedBy,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  }
}
