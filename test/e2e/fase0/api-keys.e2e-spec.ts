/**
 * E2E Tests — API Key Lifecycle
 * AC-007, AC-008, AC-009, AC-010, FR-009, FR-010, BR-001, BR-005
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

describe('API Keys (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let jwtToken: string;
  let tenantId: string;

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

    // Set up tenant and user
    const tenant = await createTestTenant(prisma, { slug: 'apikey-e2e-tenant' });
    tenantId = tenant.id;
    const user = await createTestUser(prisma, tenantId, {
      email: 'apikey-test@example.com',
      password: 'SecurePass123!',
    });

    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ tenantId, email: user.email, password: user.password });

    jwtToken = loginResponse.body.accessToken as string;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await app?.close();
  });

  describe('AC-007: POST /api/v1/api-keys', () => {
    it('creates API key with secret in 201 response', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/api-keys')
        .set('Authorization', `Bearer ${jwtToken}`)
        .send({ name: 'Test Key', environment: 'LIVE', scopes: ['invoices:read'] })
        .expect(201);

      expect(response.body.secret).toBeDefined();
      expect(response.body.secret).toMatch(/^bk_live_[a-f0-9]{8}_[a-f0-9]{32}$/);
      expect(response.body.keyHash).toBeUndefined(); // BR-001: never exposed
      expect(response.body.id).toBeDefined();
    });
  });

  describe('AC-008: GET /api/v1/api-keys', () => {
    it('lists API keys without secret or keyHash', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/api-keys')
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      // BR-001: secret and keyHash must NEVER appear
      for (const key of response.body as Array<Record<string, unknown>>) {
        expect(key['secret']).toBeUndefined();
        expect(key['keyHash']).toBeUndefined();
        expect(key['revokedBy']).toBeUndefined();
      }
    });
  });

  describe('AC-009, AC-010: API Key revocation lifecycle', () => {
    it('can revoke a key and the revoked key returns 401', async () => {
      // Create a key
      const createResponse = await request(app.getHttpServer())
        .post('/api/v1/api-keys')
        .set('Authorization', `Bearer ${jwtToken}`)
        .send({ name: 'Revocation Test Key', environment: 'TEST', scopes: [] })
        .expect(201);

      const { id, secret } = createResponse.body as { id: string; secret: string };

      // AC-009: Delete (revoke) the key
      await request(app.getHttpServer())
        .delete(`/api/v1/api-keys/${id}`)
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(204);

      // AC-010: Using revoked key returns 401
      await request(app.getHttpServer())
        .get('/api/v1/api-keys')
        .set('X-API-Key', secret)
        .expect(401);
    });

    it('BR-005: revoking an already-revoked key is idempotent (no error)', async () => {
      const createResponse = await request(app.getHttpServer())
        .post('/api/v1/api-keys')
        .set('Authorization', `Bearer ${jwtToken}`)
        .send({ name: 'Idempotent Revoke Test', environment: 'TEST', scopes: [] })
        .expect(201);

      const { id } = createResponse.body as { id: string };

      await request(app.getHttpServer())
        .delete(`/api/v1/api-keys/${id}`)
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(204);

      // Revoking again should not throw
      await request(app.getHttpServer())
        .delete(`/api/v1/api-keys/${id}`)
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(204);
    });
  });

  describe('FR-012: Correlation ID propagation', () => {
    it('AC-012: X-Correlation-ID is present in all responses', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/api-keys')
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);

      expect(response.headers['x-correlation-id']).toBeDefined();
    });

    it('propagates existing X-Correlation-ID', async () => {
      const customId = 'my-custom-correlation-id';
      const response = await request(app.getHttpServer())
        .get('/api/v1/api-keys')
        .set('Authorization', `Bearer ${jwtToken}`)
        .set('X-Correlation-ID', customId)
        .expect(200);

      expect(response.headers['x-correlation-id']).toBe(customId);
    });
  });
});
