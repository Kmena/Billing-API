/**
 * E2E Tests — Auth Flow
 * AC-003, AC-004, FR-007
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../../../src/app.module';
import { GlobalExceptionFilter } from '../../../src/api/filters/global-exception.filter';
import { CorrelationIdInterceptor } from '../../../src/api/interceptors/correlation-id.interceptor';
import { TenantContextInterceptor } from '../../../src/api/interceptors/tenant-context.interceptor';
import { createTestTenant, createTestUser } from '../../helpers/test-factories';

describe('Auth (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/ready', 'health/live'] });
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalInterceptors(app.get(CorrelationIdInterceptor), app.get(TenantContextInterceptor));

    await app.init();

    prisma = new PrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  describe('POST /api/v1/auth/login', () => {
    it('AC-003: returns 200 with tokens for valid credentials', async () => {
      const tenant = await createTestTenant(prisma);
      const user = await createTestUser(prisma, tenant.id, {
        email: 'login-test@example.com',
        password: 'SecurePass123!',
      });

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ tenantId: tenant.id, email: user.email, password: user.password })
        .expect(200);

      expect(response.body.accessToken).toBeDefined();
      expect(response.body.refreshToken).toBeDefined();
      expect(response.body.expiresIn).toBe(900);
      // FR-012: X-Correlation-ID should be present
      expect(response.headers['x-correlation-id']).toBeDefined();
    });

    it('AC-004: returns 401 for invalid credentials (no email enumeration)', async () => {
      const tenant = await createTestTenant(prisma);

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ tenantId: tenant.id, email: 'nonexistent@example.com', password: 'WrongPass' })
        .expect(401);

      expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
      // Should NOT reveal whether the email exists
      expect(response.body.error.message).not.toContain('email');
      expect(response.body.error.message).not.toContain('user');
    });

    it('returns 401 for correct email but wrong password', async () => {
      const tenant = await createTestTenant(prisma);
      const user = await createTestUser(prisma, tenant.id, { email: 'wrongpass@example.com' });

      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ tenantId: tenant.id, email: user.email, password: 'WrongPassword!' })
        .expect(401);
    });
  });

  describe('POST /api/v1/auth/refresh', () => {
    it('returns new tokens when refreshing with valid token', async () => {
      const tenant = await createTestTenant(prisma);
      const user = await createTestUser(prisma, tenant.id, {
        email: 'refresh-test@example.com',
        password: 'SecurePass123!',
      });

      const loginResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ tenantId: tenant.id, email: user.email, password: user.password })
        .expect(200);

      const refreshToken = loginResponse.body.refreshToken as string;

      const refreshResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      expect(refreshResponse.body.accessToken).toBeDefined();
      expect(refreshResponse.body.refreshToken).toBeDefined();
      // New refresh token should be different (rotation)
      expect(refreshResponse.body.refreshToken).not.toBe(refreshToken);
    });

    it('returns 401 when reusing an already-used refresh token', async () => {
      const tenant = await createTestTenant(prisma);
      const user = await createTestUser(prisma, tenant.id, {
        email: 'rotation-test@example.com',
        password: 'SecurePass123!',
      });

      const loginResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ tenantId: tenant.id, email: user.email, password: user.password })
        .expect(200);

      const refreshToken = loginResponse.body.refreshToken as string;

      // Use the token once (this should work)
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      // Try to use the same token again (should fail — rotation)
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken })
        .expect(401);
    });
  });
});
