export type EventClass = 'FISCAL_AUDIT' | 'TECHNICAL' | 'SECURITY';

export const EventClass = {
  FISCAL_AUDIT: 'FISCAL_AUDIT' as const,
  TECHNICAL: 'TECHNICAL' as const,
  SECURITY: 'SECURITY' as const,
};

export interface AuditLogProps {
  readonly id: string;
  readonly tenantId?: string;
  readonly companyId?: string;
  readonly apiKeyId?: string;
  readonly actor?: string;
  readonly action: string;
  readonly resource?: string;
  readonly endpoint?: string;
  readonly httpMethod?: string;
  readonly statusCode?: number;
  readonly ipAddress?: string;
  readonly correlationId?: string;
  readonly durationMs?: number;
  readonly eventClass: EventClass;
  readonly metadata?: Record<string, unknown>;
  readonly errorMessage?: string;
  readonly createdAt?: Date;
}

/**
 * AuditLog is append-only — no update or delete.
 * BR-003: IAuditLogRepository only exposes insert and findBy* methods.
 * ADR-009: eventClass classifies retention requirement.
 */
export class AuditLog {
  readonly id: string;
  readonly tenantId?: string;
  readonly companyId?: string;
  readonly apiKeyId?: string;
  readonly actor?: string;
  readonly action: string;
  readonly resource?: string;
  readonly endpoint?: string;
  readonly httpMethod?: string;
  readonly statusCode?: number;
  readonly ipAddress?: string;
  readonly correlationId?: string;
  readonly durationMs?: number;
  readonly eventClass: EventClass;
  readonly metadata?: Record<string, unknown>;
  readonly errorMessage?: string;
  readonly createdAt: Date;

  constructor(props: AuditLogProps) {
    this.id = props.id;
    this.tenantId = props.tenantId;
    this.companyId = props.companyId;
    this.apiKeyId = props.apiKeyId;
    this.actor = props.actor;
    this.action = props.action;
    this.resource = props.resource;
    this.endpoint = props.endpoint;
    this.httpMethod = props.httpMethod;
    this.statusCode = props.statusCode;
    this.ipAddress = props.ipAddress;
    this.correlationId = props.correlationId;
    this.durationMs = props.durationMs;
    this.eventClass = props.eventClass;
    this.metadata = props.metadata;
    this.errorMessage = props.errorMessage;
    this.createdAt = props.createdAt ?? new Date();
  }
}
