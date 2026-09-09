import { AuditLog } from '../entities/audit-log.entity';

export interface FindAuditLogsFilter {
  tenantId?: string;
  correlationId?: string;
  action?: string;
  apiKeyId?: string;
  limit?: number;
}

/**
 * BR-003: Repository is append-only — no update(), no delete().
 */
export interface IAuditLogRepository {
  insert(log: AuditLog): Promise<void>;
  findByCorrelationId(correlationId: string): Promise<AuditLog[]>;
  findByTenant(tenantId: string, limit?: number): Promise<AuditLog[]>;
}

export const AUDIT_LOG_REPOSITORY = Symbol('IAuditLogRepository');
