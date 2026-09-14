import { Module } from '@nestjs/common';
import { HttpModule, HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { SecretsModule } from '../../infrastructure/secrets/secrets.module';
import { AuditModule } from '../audit/audit.module';
import { CompaniesModule } from '../companies/companies.module';
import { HaciendaConnectionController } from './infrastructure/http/hacienda-connection.controller';
import { PrismaHaciendaConnectionRepository } from './infrastructure/persistence/prisma-hacienda-connection.repository';
import { HaciendaTokenCache } from './infrastructure/auth/hacienda-token-cache.service';
import { HaciendaOidcAuthAdapter } from './infrastructure/auth/hacienda-oidc-auth.adapter';
import { MockHaciendaAuthAdapter } from './infrastructure/auth/mock-hacienda-auth.adapter';
import { HACIENDA_CONNECTION_REPOSITORY } from './domain/ports/hacienda-connection.repository';
import { HACIENDA_AUTH_PORT } from './domain/ports/hacienda-auth.port';
import { ConfigureConnectionHandler } from './application/use-cases/configure-connection/configure-connection.handler';
import { GetConnectionHandler } from './application/use-cases/get-connection/get-connection.handler';
import { ValidateConnectionHandler } from './application/use-cases/validate-connection/validate-connection.handler';
import { DisableConnectionHandler } from './application/use-cases/disable-connection/disable-connection.handler';

@Module({
  imports: [HttpModule, DatabaseModule, SecretsModule, AuditModule, CompaniesModule],
  controllers: [HaciendaConnectionController],
  providers: [
    ConfigureConnectionHandler,
    GetConnectionHandler,
    ValidateConnectionHandler,
    DisableConnectionHandler,
    HaciendaTokenCache,
    { provide: HACIENDA_CONNECTION_REPOSITORY, useClass: PrismaHaciendaConnectionRepository },
    {
      provide: HACIENDA_AUTH_PORT,
      useFactory: (config: ConfigService, http: HttpService) =>
        config.get<boolean>('hacienda.useReal')
          ? new HaciendaOidcAuthAdapter(config, http)
          : new MockHaciendaAuthAdapter(),
      inject: [ConfigService, HttpService],
    },
  ],
  exports: [
    ConfigureConnectionHandler,
    GetConnectionHandler,
    ValidateConnectionHandler,
    HaciendaTokenCache,
    HACIENDA_AUTH_PORT,
  ],
})
export class HaciendaConnectionModule {}
