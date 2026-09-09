import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SECRET_PROVIDER } from './ports/secret-provider.port';
import { EnvSecretProvider } from './adapters/env-secret-provider.adapter';
import { AwsParameterStoreSecretProvider } from './adapters/aws-parameter-store.adapter';

@Global()
@Module({
  providers: [
    {
      provide: SECRET_PROVIDER,
      useFactory: (configService: ConfigService) => {
        const provider = configService.get<string>('secrets.provider') ?? 'env';
        if (provider === 'ssm') {
          return new AwsParameterStoreSecretProvider(configService);
        }
        return new EnvSecretProvider();
      },
      inject: [ConfigService],
    },
    EnvSecretProvider,
    AwsParameterStoreSecretProvider,
  ],
  exports: [SECRET_PROVIDER],
})
export class SecretsModule {}
