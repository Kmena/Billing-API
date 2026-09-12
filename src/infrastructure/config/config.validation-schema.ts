import * as Joi from 'joi';

const productionOrStaging = Joi.valid('production', 'staging');
const AUTH_DURATION_PATTERN = /^\d+[smhd]$/;

const haciendaAuthUrl = (defaultValue: string): Joi.Schema =>
  Joi.when('NODE_ENV', {
    is: productionOrStaging,
    then: Joi.string()
      .uri({ scheme: ['https'] })
      .required(),
    otherwise: Joi.string()
      .uri({ scheme: ['https'] })
      .default(defaultValue),
  });

const haciendaAuthClientId = (defaultValue: string): Joi.Schema =>
  Joi.when('NODE_ENV', {
    is: productionOrStaging,
    then: Joi.string().trim().min(1).required(),
    otherwise: Joi.string().trim().min(1).default(defaultValue),
  });

/**
 * Joi validation schema for all environment variables.
 * Exported separately so unit tests can validate rules without booting NestJS.
 */
export const validationSchema = Joi.object({
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
  JWT_EXPIRES_IN: Joi.string().pattern(AUTH_DURATION_PATTERN).default('15m'),
  JWT_REFRESH_EXPIRES_IN: Joi.string().pattern(AUTH_DURATION_PATTERN).default('7d'),

  // Storage
  STORAGE_TYPE: Joi.string().valid('local', 's3').default('local'),
  LOCAL_STORAGE_PATH: Joi.string().default('./storage'),
  LOCAL_STORAGE_SECRET: Joi.string().default('local-signing-secret-dev-only'),
  AWS_S3_BUCKET: Joi.string().optional(),
  AWS_S3_ENDPOINT: Joi.string().optional(),
  AWS_REGION: Joi.string().default('us-east-1'),

  // Secrets
  SECRET_PROVIDER: Joi.string().valid('env', 'ssm').default('env'),
  SSM_PARAMETER_PREFIX: Joi.string().default('/billing'),

  // CORS
  CORS_ALLOWED_ORIGINS: Joi.when('NODE_ENV', {
    is: Joi.valid('production', 'staging'),
    then: Joi.string().invalid('*').required().messages({
      'any.invalid': 'CORS_ALLOWED_ORIGINS must not be wildcard (*) in production or staging.',
      'any.required': 'CORS_ALLOWED_ORIGINS is required in production and staging.',
    }),
    otherwise: Joi.string().default('*'),
  }),

  // Rate limiting — Layer A (per API Key) and Layer B (auth brute-force)
  // @nestjs/throttler v6 uses milliseconds for TTL
  THROTTLE_API_TTL: Joi.number().positive().default(60000),
  THROTTLE_API_LIMIT: Joi.number().positive().default(100),
  THROTTLE_AUTH_TTL: Joi.number().positive().default(60000),
  THROTTLE_AUTH_LIMIT: Joi.number().positive().default(10),

  // Hacienda integration
  USE_REAL_HACIENDA: Joi.boolean().truthy('true').falsy('false').default(false),
  HACIENDA_API_BASE_URL: Joi.string().uri().default('https://api.hacienda.go.cr'),
  HACIENDA_TIMEOUT_MS: Joi.number().positive().default(10000),

  // Hacienda cache TTLs — cache-manager v7 uses milliseconds
  TAXPAYER_CACHE_TTL_MS: Joi.number().positive().default(3600000), // 1 hour
  EXCHANGE_RATE_CACHE_TTL_MS: Joi.number().positive().default(14400000), // 4 hours
  CABYS_ITEM_CACHE_TTL_MS: Joi.number().positive().default(86400000), // 24 hours
  CABYS_SEARCH_CACHE_TTL_MS: Joi.number().positive().default(3600000), // 1 hour

  // Hacienda resilience — circuit breaker and retry tuning
  HACIENDA_CB_FAILURE_THRESHOLD: Joi.number().integer().positive().default(5),
  HACIENDA_CB_RESET_TIMEOUT_MS: Joi.number().integer().positive().default(30000),
  HACIENDA_CB_OUTBOUND_RATE_PER_SECOND: Joi.number().integer().positive().max(10).default(8),
  HACIENDA_RETRY_429_COUNT: Joi.number().integer().positive().default(2),
  HACIENDA_RETRY_429_BASE_DELAY_MS: Joi.number().integer().positive().default(1000),
  HACIENDA_RETRY_5XX_COUNT: Joi.number().integer().positive().default(1),
  HACIENDA_RETRY_5XX_DELAY_MS: Joi.number().integer().positive().default(2000),

  // Hacienda private IDP authentication
  HACIENDA_IDP_PRODUCTION_URL: haciendaAuthUrl(
    'https://idp.comprobanteselectronicos.go.cr/auth/realms/rut/protocol/openid-connect/token',
  ),
  HACIENDA_IDP_SANDBOX_URL: haciendaAuthUrl(
    'https://idp.comprobanteselectronicos.go.cr/auth/realms/rut-stag/protocol/openid-connect/token',
  ),
  HACIENDA_IDP_CLIENT_ID_PRODUCTION: haciendaAuthClientId('api-prod'),
  HACIENDA_IDP_CLIENT_ID_SANDBOX: haciendaAuthClientId('api-stag'),
  HACIENDA_AUTH_TIMEOUT_MS: Joi.number().integer().positive().default(10000),
  HACIENDA_AUTH_TOKEN_EXPIRY_SAFETY_MARGIN_MS: Joi.number().integer().positive().default(30000),
  HACIENDA_AUTH_RETRY_5XX_COUNT: Joi.number().integer().positive().default(1),
  HACIENDA_AUTH_RETRY_5XX_DELAY_MS: Joi.number().integer().positive().default(2000),
});
