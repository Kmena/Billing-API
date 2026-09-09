import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import Joi from 'joi';
import appConfig from './app.config';
import databaseConfig from './database.config';
import authConfig from './auth.config';
import storageConfig from './storage.config';
import secretsConfig from './secrets.config';

const validationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test', 'staging')
    .default('development'),
  PORT: Joi.number().default(3000),
  LOG_LEVEL: Joi.string().valid('trace', 'debug', 'info', 'warn', 'error', 'fatal').default('info'),

  // Database — always required
  DATABASE_URL: Joi.string().required(),

  // Auth
  JWT_SECRET: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().min(32).required(),
    otherwise: Joi.string().default('dev-insecure-jwt-secret-change-in-production'),
  }),
  JWT_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),

  // Storage
  STORAGE_TYPE: Joi.string().valid('local', 's3').default('local'),
  AWS_S3_BUCKET: Joi.string().optional(),
  AWS_S3_ENDPOINT: Joi.string().optional(),
  AWS_REGION: Joi.string().default('us-east-1'),

  // Secrets
  SECRET_PROVIDER: Joi.string().valid('env', 'ssm').default('env'),
  SSM_PARAMETER_PREFIX: Joi.string().default('/billing'),
});

@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig, authConfig, storageConfig, secretsConfig],
      validationSchema,
      validationOptions: {
        abortEarly: true,
      },
    }),
  ],
  exports: [NestConfigModule],
})
export class ConfigModule {}
