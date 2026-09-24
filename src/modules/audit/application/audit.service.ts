import { randomUUID } from 'crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuditLog, AuditLogProps, EventClass } from '../domain/entities/audit-log.entity';
import { IAuditLogRepository, AUDIT_LOG_REPOSITORY } from '../domain/ports/audit-log.repository';

export type RecordAuditLogCommand = Omit<AuditLogProps, 'id' | 'createdAt'>;

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @Inject(AUDIT_LOG_REPOSITORY)
    private readonly auditLogRepository: IAuditLogRepository,
  ) {}

  /**
   * Records an audit log entry.
   * FR-011: Non-blocking — failures do not propagate to the caller (fire-and-forget).
   * ADR-009: eventClass defaults to TECHNICAL for Phase 0 events.
   */
  record(command: RecordAuditLogCommand): void {
    const log = new AuditLog({
      ...command,
      id: randomUUID(),
      eventClass: command.eventClass ?? EventClass.TECHNICAL,
    });

    this.auditLogRepository.insert(log).catch((err: Error) => {
      // Non-blocking — log the error but do not throw
      this.logger.error(
        { correlationId: log.correlationId, action: log.action, error: err.message },
        'Failed to write audit log — non-critical',
      );
    });
  }

  async findByCorrelationId(correlationId: string): Promise<AuditLog[]> {
    return this.auditLogRepository.findByCorrelationId(correlationId);
  }
}

// Re-export EventClass for convenience
export { EventClass };
