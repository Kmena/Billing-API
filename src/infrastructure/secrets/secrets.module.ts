import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SECRET_PROVIDER } from './ports/secret-provider.port';
import { EnvSecretProvider } from './adapters/env-secret-provider.adapter';
import { AwsParameterStoreSecretProvider } from './adapters/aws-parameter-store.adapter';
import { EncryptedFileSecretProvider } from './adapters/encrypted-file-secret-provider.adapter';
import { SecretStoreReadinessService } from './secret-store-readiness.service';

@Global()
@Module({
  providers: [
    SecretStoreReadinessService,
    {
      provide: SECRET_PROVIDER,
      useFactory: (configService: ConfigService) => {
        const provider = configService.get<string>('secrets.provider') ?? 'ssm';
        if (provider === 'ssm') {
          return new AwsParameterStoreSecretProvider(configService);
        }
        if (provider === 'env') {
          return new EnvSecretProvider();
        }
        if (provider === 'local-encrypted') {
          const rootPath = configService.get<string>('secrets.localStorePath');
          const masterKeyPath = configService.get<string>('secrets.localMasterKeyPath');
          if (!rootPath || !masterKeyPath) {
            throw new Error(
              'Encrypted local secret provider requires explicit store and master-key paths.',
            );
          }
          return new EncryptedFileSecretProvider({
            rootPath,
            masterKeyPath,
            requiredMarker: configService.get<string>('secrets.localRequiredMarker'),
          });
        }
        throw new Error(`Unsupported explicit secret provider: ${provider}`);
      },
      inject: [ConfigService],
    },
    EnvSecretProvider,
    AwsParameterStoreSecretProvider,
  ],
  exports: [SECRET_PROVIDER],
})
export class SecretsModule {}
