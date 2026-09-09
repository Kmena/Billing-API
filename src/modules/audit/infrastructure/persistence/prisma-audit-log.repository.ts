import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import { IAuditLogRepository } from '../../domain/ports/audit-log.repository';
import { AuditLog } from '../../domain/entities/audit-log.entity';

@Injectable()
export class PrismaAuditLogRepository implements IAuditLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  async insert(log: AuditLog): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        id: log.id,
        tenantId: log.tenantId,
        companyId: log.companyId,
        apiKeyId: log.apiKeyId,
        actor: log.actor,
        action: log.action,
        resource: log.resource,
        endpoint: log.endpoint,
        httpMethod: log.httpMethod,
        statusCode: log.statusCode,
        ipAddress: log.ipAddress,
        correlationId: log.correlationId,
        durationMs: log.durationMs,
        eventClass: log.eventClass,
        metadata: (log.metadata as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        errorMessage: log.errorMessage,
        createdAt: log.createdAt,
      },
    });
  }

  async findByCorrelationId(correlationId: string): Promise<AuditLog[]> {
    const records = await this.prisma.auditLog.findMany({
      where: { correlationId },
      orderBy: { createdAt: 'asc' },
    });
    return records.map((r) => this.toDomain(r));
  }

  async findByTenant(tenantId: string, limit = 100): Promise<AuditLog[]> {
    const records = await this.prisma.auditLog.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return records.map((r) => this.toDomain(r));
  }

  private toDomain(record: {
    id: string;
    tenantId: string | null;
    companyId: string | null;
    apiKeyId: string | null;
    actor: string | null;
    action: string;
    resource: string | null;
    endpoint: string | null;
    httpMethod: string | null;
    statusCode: number | null;
    ipAddress: string | null;
    correlationId: string | null;
    durationMs: number | null;
    eventClass: string;
    metadata: unknown;
    errorMessage: string | null;
    createdAt: Date;
  }): AuditLog {
    return new AuditLog({
      id: record.id,
      tenantId: record.tenantId ?? undefined,
      companyId: record.companyId ?? undefined,
      apiKeyId: record.apiKeyId ?? undefined,
      actor: record.actor ?? undefined,
      action: record.action,
      resource: record.resource ?? undefined,
      endpoint: record.endpoint ?? undefined,
      httpMethod: record.httpMethod ?? undefined,
      statusCode: record.statusCode ?? undefined,
      ipAddress: record.ipAddress ?? undefined,
      correlationId: record.correlationId ?? undefined,
      durationMs: record.durationMs ?? undefined,
      eventClass: record.eventClass as AuditLog['eventClass'],
      metadata: record.metadata as Record<string, unknown> | undefined,
      errorMessage: record.errorMessage ?? undefined,
      createdAt: record.createdAt,
    });
  }
}
