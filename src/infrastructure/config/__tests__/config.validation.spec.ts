import { validationSchema } from '../config.validation-schema';

describe('configuration validation schema', () => {
  const validDatabaseUrl = 'postgresql://test';
  const validJwtSecret = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

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
      },
      { abortEarly: false },
    );

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('JWT_SECRET');
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
