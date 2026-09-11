import { validationSchema } from '../config.validation-schema';

describe('configuration validation schema', () => {
  const validDatabaseUrl = 'postgresql://test';
  const validJwtSecret = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const validProductionConfig = {
    HACIENDA_IDP_PRODUCTION_URL:
      'https://idp.example.com/auth/realms/rut/protocol/openid-connect/token',
    HACIENDA_IDP_SANDBOX_URL:
      'https://idp.example.com/auth/realms/rut-stag/protocol/openid-connect/token',
    HACIENDA_IDP_CLIENT_ID_PRODUCTION: 'api-prod',
    HACIENDA_IDP_CLIENT_ID_SANDBOX: 'api-stag',
  };

  it('rejects production without CORS_ALLOWED_ORIGINS (AC-001)', () => {
    const result = validationSchema.validate(
      {
        NODE_ENV: 'production',
        DATABASE_URL: validDatabaseUrl,
        JWT_SECRET: validJwtSecret,
      },
      { abortEarly: false },
    );

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('CORS_ALLOWED_ORIGINS is required');
  });

  it('rejects production with wildcard CORS_ALLOWED_ORIGINS (AC-002)', () => {
    const result = validationSchema.validate(
      {
        NODE_ENV: 'production',
        DATABASE_URL: validDatabaseUrl,
        JWT_SECRET: validJwtSecret,
        CORS_ALLOWED_ORIGINS: '*',
      },
      { abortEarly: false },
    );

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('CORS_ALLOWED_ORIGINS must not be wildcard');
  });

  it('accepts production with explicit origin and strong JWT secret (AC-004)', () => {
    const result = validationSchema.validate(
      {
        NODE_ENV: 'production',
        DATABASE_URL: validDatabaseUrl,
        JWT_SECRET: validJwtSecret,
        CORS_ALLOWED_ORIGINS: 'https://app.example.com',
        ...validProductionConfig,
      },
      { abortEarly: false },
    );

    expect(result.error).toBeUndefined();
    expect(result.value.CORS_ALLOWED_ORIGINS).toBe('https://app.example.com');
  });

  it('defaults development CORS_ALLOWED_ORIGINS to wildcard when absent (AC-003)', () => {
    const result = validationSchema.validate(
      {
        NODE_ENV: 'development',
        DATABASE_URL: validDatabaseUrl,
      },
      { abortEarly: false },
    );

    expect(result.error).toBeUndefined();
    expect(result.value.CORS_ALLOWED_ORIGINS).toBe('*');
  });

  it('accepts test environment without CORS_ALLOWED_ORIGINS (AC-003)', () => {
    const result = validationSchema.validate(
      {
        NODE_ENV: 'test',
        DATABASE_URL: validDatabaseUrl,
      },
      { abortEarly: false },
    );

    expect(result.error).toBeUndefined();
  });

  it('rejects staging with wildcard CORS_ALLOWED_ORIGINS', () => {
    const result = validationSchema.validate(
      {
        NODE_ENV: 'staging',
        DATABASE_URL: validDatabaseUrl,
        JWT_SECRET: validJwtSecret,
        CORS_ALLOWED_ORIGINS: '*',
      },
      { abortEarly: false },
    );

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('CORS_ALLOWED_ORIGINS must not be wildcard');
  });

  it('rejects missing DATABASE_URL regardless of environment', () => {
    const result = validationSchema.validate(
      {
        NODE_ENV: 'test',
      },
      { abortEarly: false },
    );

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('DATABASE_URL');
  });

  it('rejects production JWT_SECRET shorter than 32 characters', () => {
    const result = validationSchema.validate(
      {
        NODE_ENV: 'production',
        DATABASE_URL: validDatabaseUrl,
        JWT_SECRET: 'short-secret',
        CORS_ALLOWED_ORIGINS: 'https://app.example.com',
        ...validProductionConfig,
      },
      { abortEarly: false },
    );

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('JWT_SECRET');
  });

  it('applies Hacienda auth defaults in development and test', () => {
    const result = validationSchema.validate(
      {
        NODE_ENV: 'test',
        DATABASE_URL: validDatabaseUrl,
      },
      { abortEarly: false },
    );

    expect(result.error).toBeUndefined();
    expect(result.value.HACIENDA_IDP_PRODUCTION_URL).toContain('rut/protocol');
    expect(result.value.HACIENDA_IDP_SANDBOX_URL).toContain('rut-stag/protocol');
    expect(result.value.HACIENDA_IDP_CLIENT_ID_PRODUCTION).toBe('api-prod');
    expect(result.value.HACIENDA_IDP_CLIENT_ID_SANDBOX).toBe('api-stag');
    expect(result.value.HACIENDA_AUTH_TIMEOUT_MS).toBe(10000);
    expect(result.value.HACIENDA_AUTH_TOKEN_EXPIRY_SAFETY_MARGIN_MS).toBe(30000);
    expect(result.value.HACIENDA_AUTH_RETRY_5XX_COUNT).toBe(1);
    expect(result.value.HACIENDA_AUTH_RETRY_5XX_DELAY_MS).toBe(2000);
  });

  it('rejects malformed Hacienda auth URLs', () => {
    const result = validationSchema.validate(
      {
        NODE_ENV: 'test',
        DATABASE_URL: validDatabaseUrl,
        HACIENDA_IDP_PRODUCTION_URL: 'not-a-url',
      },
      { abortEarly: false },
    );

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('HACIENDA_IDP_PRODUCTION_URL');
  });

  it('rejects invalid Hacienda auth numeric values', () => {
    const result = validationSchema.validate(
      {
        NODE_ENV: 'test',
        DATABASE_URL: validDatabaseUrl,
        HACIENDA_AUTH_TIMEOUT_MS: 0,
        HACIENDA_AUTH_TOKEN_EXPIRY_SAFETY_MARGIN_MS: -1,
        HACIENDA_AUTH_RETRY_5XX_COUNT: 0,
        HACIENDA_AUTH_RETRY_5XX_DELAY_MS: -10,
      },
      { abortEarly: false },
    );

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('HACIENDA_AUTH_TIMEOUT_MS');
    expect(result.error?.message).toContain('HACIENDA_AUTH_TOKEN_EXPIRY_SAFETY_MARGIN_MS');
    expect(result.error?.message).toContain('HACIENDA_AUTH_RETRY_5XX_COUNT');
    expect(result.error?.message).toContain('HACIENDA_AUTH_RETRY_5XX_DELAY_MS');
  });

  it('requires explicit Hacienda auth endpoints and client ids in production', () => {
    const result = validationSchema.validate(
      {
        NODE_ENV: 'production',
        DATABASE_URL: validDatabaseUrl,
        JWT_SECRET: validJwtSecret,
        CORS_ALLOWED_ORIGINS: 'https://app.example.com',
      },
      { abortEarly: false },
    );

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('HACIENDA_IDP_PRODUCTION_URL');
    expect(result.error?.message).toContain('HACIENDA_IDP_SANDBOX_URL');
    expect(result.error?.message).toContain('HACIENDA_IDP_CLIENT_ID_PRODUCTION');
    expect(result.error?.message).toContain('HACIENDA_IDP_CLIENT_ID_SANDBOX');
  });

  it('requires explicit Hacienda auth endpoints and client ids in staging', () => {
    const result = validationSchema.validate(
      {
        NODE_ENV: 'staging',
        DATABASE_URL: validDatabaseUrl,
        JWT_SECRET: validJwtSecret,
        CORS_ALLOWED_ORIGINS: 'https://staging.example.com',
      },
      { abortEarly: false },
    );

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('HACIENDA_IDP_PRODUCTION_URL');
    expect(result.error?.message).toContain('HACIENDA_IDP_SANDBOX_URL');
    expect(result.error?.message).toContain('HACIENDA_IDP_CLIENT_ID_PRODUCTION');
    expect(result.error?.message).toContain('HACIENDA_IDP_CLIENT_ID_SANDBOX');
  });

  it('applies correct CB defaults (BR-003, BR-004)', () => {
    const result = validationSchema.validate(
      {
        NODE_ENV: 'test',
        DATABASE_URL: validDatabaseUrl,
      },
      { abortEarly: false },
    );

    expect(result.error).toBeUndefined();
    expect(result.value.HACIENDA_CB_FAILURE_THRESHOLD).toBe(5);
    expect(result.value.HACIENDA_CB_RESET_TIMEOUT_MS).toBe(30000);
    expect(result.value.HACIENDA_CB_OUTBOUND_RATE_PER_SECOND).toBe(8);
  });

  it('rejects HACIENDA_CB_OUTBOUND_RATE_PER_SECOND above 10 (R-12)', () => {
    const result = validationSchema.validate(
      {
        NODE_ENV: 'test',
        DATABASE_URL: validDatabaseUrl,
        HACIENDA_CB_OUTBOUND_RATE_PER_SECOND: 11,
      },
      { abortEarly: false },
    );

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('HACIENDA_CB_OUTBOUND_RATE_PER_SECOND');
  });
});
