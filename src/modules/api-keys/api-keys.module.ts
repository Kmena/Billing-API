import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { IdentityModule } from '../identity/identity.module';
import { API_KEY_REPOSITORY } from './domain/ports/api-key.repository';
import { CreateApiKeyHandler } from './application/use-cases/create-api-key/create-api-key.handler';
import { ListApiKeysHandler } from './application/use-cases/list-api-keys/list-api-keys.handler';
import { RevokeApiKeyHandler } from './application/use-cases/revoke-api-key/revoke-api-key.handler';
import { ValidateApiKeyHandler } from './application/use-cases/validate-api-key/validate-api-key.handler';
import { PrismaApiKeyRepository } from './infrastructure/persistence/prisma-api-key.repository';
import { ApiKeysController } from './infrastructure/http/api-keys.controller';
import { ApiKeyAuthGuard } from '../../api/guards/api-key-auth.guard';

@Module({
  imports: [DatabaseModule, IdentityModule],
  controllers: [ApiKeysController],
  providers: [
    CreateApiKeyHandler,
    ListApiKeysHandler,
    RevokeApiKeyHandler,
    ValidateApiKeyHandler,
    ApiKeyAuthGuard,
    {
      provide: API_KEY_REPOSITORY,
      useClass: PrismaApiKeyRepository,
    },
  ],
  exports: [
    CreateApiKeyHandler,
    ListApiKeysHandler,
    RevokeApiKeyHandler,
    ValidateApiKeyHandler,
    ApiKeyAuthGuard,
  ],
})
export class ApiKeysModule {}
