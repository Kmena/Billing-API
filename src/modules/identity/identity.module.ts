import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { SecretsModule } from '../../infrastructure/secrets/secrets.module';
import { TENANT_REPOSITORY } from './domain/ports/tenant.repository';
import { USER_REPOSITORY } from './domain/ports/user.repository';
import { REFRESH_TOKEN_REPOSITORY } from './domain/ports/refresh-token.repository';
import { CreateTenantHandler } from './application/use-cases/create-tenant/create-tenant.handler';
import { GetTenantHandler } from './application/use-cases/get-tenant/get-tenant.handler';
import { CreateUserHandler } from './application/use-cases/create-user/create-user.handler';
import { LoginHandler } from './application/use-cases/login/login.handler';
import { RefreshTokenHandler } from './application/use-cases/refresh-token/refresh-token.handler';
import { PrismaTenantRepository } from './infrastructure/persistence/prisma-tenant.repository';
import { PrismaUserRepository } from './infrastructure/persistence/prisma-user.repository';
import { PrismaRefreshTokenRepository } from './infrastructure/persistence/prisma-refresh-token.repository';
import { TenantController } from './infrastructure/http/tenant.controller';
import { AuthController } from './infrastructure/http/auth.controller';
import { JwtStrategy } from '../../api/strategies/jwt.strategy';
import { JwtAuthGuard } from '../../api/guards/jwt-auth.guard';

@Module({
  imports: [
    DatabaseModule,
    SecretsModule,
    PassportModule,
    JwtModule.register({
      // Secret is fetched dynamically via SecretProvider in JwtStrategy
      signOptions: { expiresIn: '15m' },
    }),
  ],
  controllers: [TenantController, AuthController],
  providers: [
    CreateTenantHandler,
    GetTenantHandler,
    CreateUserHandler,
    LoginHandler,
    RefreshTokenHandler,
    JwtStrategy,
    JwtAuthGuard,
    {
      provide: TENANT_REPOSITORY,
      useClass: PrismaTenantRepository,
    },
    {
      provide: USER_REPOSITORY,
      useClass: PrismaUserRepository,
    },
    {
      provide: REFRESH_TOKEN_REPOSITORY,
      useClass: PrismaRefreshTokenRepository,
    },
  ],
  exports: [
    CreateTenantHandler,
    GetTenantHandler,
    CreateUserHandler,
    LoginHandler,
    RefreshTokenHandler,
    JwtAuthGuard,
    JwtModule,
    PassportModule,
  ],
})
export class IdentityModule {}
