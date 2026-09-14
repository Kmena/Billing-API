import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { validationSchema } from './config.validation-schema';
import appConfig from './app.config';
import databaseConfig from './database.config';
import authConfig from './auth.config';
import storageConfig from './storage.config';
import secretsConfig from './secrets.config';
import haciendaConfig from './hacienda.config';
import haciendaAuthConfig from './hacienda-auth.config';
import haciendaSubmissionConfig from './hacienda-submission.config';

export { validationSchema } from './config.validation-schema';

@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      load: [
        appConfig,
        databaseConfig,
        authConfig,
        storageConfig,
        secretsConfig,
        haciendaConfig,
        haciendaAuthConfig,
        haciendaSubmissionConfig,
      ],
      validationSchema,
      validationOptions: {
        abortEarly: true,
      },
    }),
  ],
  exports: [NestConfigModule],
})
export class ConfigModule {}
