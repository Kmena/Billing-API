import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { ConfigModule } from './infrastructure/config/config.module';
import { DatabaseModule } from './infrastructure/database/database.module';
import { SecretsModule } from './infrastructure/secrets/secrets.module';
import { AuditModule } from './modules/audit/audit.module';
import { StorageModule } from './infrastructure/storage/storage.module';
import { QueueModule } from './infrastructure/queue/queue.module';
import { HaciendaModule } from './infrastructure/integrations/hacienda/hacienda.module';
import { IdentityModule } from './modules/identity/identity.module';
import { CompaniesModule } from './modules/companies/companies.module';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { HealthController } from './api/health/health.controller';
import { PrismaHealthIndicator } from './api/health/indicators/prisma.health-indicator';
import { CorrelationIdInterceptor } from './api/interceptors/correlation-id.interceptor';
import { TenantContextInterceptor } from './api/interceptors/tenant-context.interceptor';
import { AuditInterceptor } from './api/interceptors/audit.interceptor';

@Module({
  imports: [
    // Core infrastructure (order matters: config → db → secrets → audit)
    ConfigModule,
    DatabaseModule,
    SecretsModule,
    AuditModule,

    // Shared infrastructure — registered globally for all business modules
    StorageModule,
    QueueModule,
    HaciendaModule,

    // Health checks
    TerminusModule,

    // Business modules
    IdentityModule,
    CompaniesModule,
    ApiKeysModule,
  ],
  controllers: [HealthController],
  providers: [
    PrismaHealthIndicator,
    // Register interceptors as providers so app.get() resolves them with DI
    CorrelationIdInterceptor,
    TenantContextInterceptor,
    AuditInterceptor,
  ],
})
export class AppModule {}
