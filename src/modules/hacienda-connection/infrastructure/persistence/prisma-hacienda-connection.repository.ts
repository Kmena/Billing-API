import { Injectable } from '@nestjs/common';
import type { HaciendaConnection as PrismaHaciendaConnection } from '@prisma/client';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import { TenantAwarePrismaRepository } from '../../../../infrastructure/database/tenant-aware-prisma.repository';
import { HaciendaConnection } from '../../domain/entities/hacienda-connection.entity';
import type { HaciendaEnvironment } from '../../domain/entities/hacienda-connection.entity';
import type { IHaciendaConnectionRepository } from '../../domain/ports/hacienda-connection.repository';

@Injectable()
export class PrismaHaciendaConnectionRepository
  extends TenantAwarePrismaRepository
  implements IHaciendaConnectionRepository
{
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async findByCompanyAndEnvironment(
    companyId: string,
    environment: HaciendaEnvironment,
  ): Promise<HaciendaConnection | null> {
    const record = await this.prisma.haciendaConnection.findFirst({
      where: this.applyTenantFilter({ companyId, environment }),
    });
    return record ? this.toDomain(record) : null;
  }

  async save(connection: HaciendaConnection): Promise<void> {
    await this.prisma.haciendaConnection.upsert({
      where: {
        companyId_environment: {
          companyId: connection.companyId,
          environment: connection.environment,
        },
      },
      create: {
        id: connection.id,
        tenantId: connection.tenantId,
        companyId: connection.companyId,
        environment: connection.environment,
        status: connection.status,
        secretReference: connection.secretReference,
        lastValidatedAt: connection.lastValidatedAt,
        lastSuccessfulAuthAt: connection.lastSuccessfulAuthAt,
        lastValidationErrorCode: connection.lastValidationErrorCode,
        createdAt: connection.createdAt,
        updatedAt: connection.updatedAt,
      },
      update: {
        status: connection.status,
        secretReference: connection.secretReference,
        lastValidatedAt: connection.lastValidatedAt,
        lastSuccessfulAuthAt: connection.lastSuccessfulAuthAt,
        lastValidationErrorCode: connection.lastValidationErrorCode,
        updatedAt: connection.updatedAt,
      },
    });
  }

  private toDomain(record: PrismaHaciendaConnection): HaciendaConnection {
    return HaciendaConnection.reconstruct({
      id: record.id,
      tenantId: record.tenantId,
      companyId: record.companyId,
      environment: record.environment,
      status: record.status,
      secretReference: record.secretReference,
      lastValidatedAt: record.lastValidatedAt ?? undefined,
      lastSuccessfulAuthAt: record.lastSuccessfulAuthAt ?? undefined,
      lastValidationErrorCode: record.lastValidationErrorCode ?? undefined,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  }
}
