import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
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
import { TaxpayersModule } from './modules/taxpayers/taxpayers.module';
import { CabysModule } from './modules/cabys/cabys.module';
import { ExchangeRatesModule } from './modules/exchange-rates/exchange-rates.module';
import { HealthController } from './api/health/health.controller';
import { PrismaHealthIndicator } from './api/health/indicators/prisma.health-indicator';
import { CorrelationIdInterceptor } from './api/interceptors/correlation-id.interceptor';
import { TenantContextInterceptor } from './api/interceptors/tenant-context.interceptor';
import { AuditInterceptor } from './api/interceptors/audit.interceptor';
import { ConfigService } from '@nestjs/config';

@Module({
  imports: [
    // Core infrastructure
    ConfigModule,
    DatabaseModule,
    SecretsModule,
    AuditModule,

    // Layered rate limiting — TASK-004 (DEC-007)
    // @nestjs/throttler v6: minutes(1) = 60000ms
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        throttlers: [
          {
            name: 'api', // Layer A — per API Key, used by ApiKeyThrottlerGuard
            ttl: cfg.get<number>('THROTTLE_API_TTL') ?? 60000,
            limit: cfg.get<number>('THROTTLE_API_LIMIT') ?? 100,
          },
          {
            name: 'auth', // Layer B — per IP, used on AuthController only
            ttl: cfg.get<number>('THROTTLE_AUTH_TTL') ?? 60000,
            limit: cfg.get<number>('THROTTLE_AUTH_LIMIT') ?? 10,
          },
        ],
      }),
    }),

    // Shared infrastructure
    StorageModule,
    QueueModule,
    HaciendaModule,

    // Health checks
    TerminusModule,

    // Business modules
    IdentityModule,
    CompaniesModule,
    ApiKeysModule,

    // Fase 1: Hacienda query endpoints
    TaxpayersModule,
    CabysModule,
    ExchangeRatesModule,
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
