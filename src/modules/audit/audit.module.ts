import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { AUDIT_LOG_REPOSITORY } from './domain/ports/audit-log.repository';
import { AuditService } from './application/audit.service';
import { PrismaAuditLogRepository } from './infrastructure/persistence/prisma-audit-log.repository';

@Global()
@Module({
  imports: [DatabaseModule],
  providers: [
    AuditService,
    {
      provide: AUDIT_LOG_REPOSITORY,
      useClass: PrismaAuditLogRepository,
    },
  ],
  exports: [AuditService],
})
export class AuditModule {}
