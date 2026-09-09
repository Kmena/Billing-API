/**
 * E2E Tests — Tenant Isolation (AC-018)
 * FR-005, BR-002: Tenant A cannot see Tenant B's data
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

describe('Tenant Isolation (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  // Tenant A
  let tokenA: string;
  let tenantAId: string;

  // Tenant B
  let tokenB: string;
  let tenantBId: string;

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

    // Set up Tenant A
    const tenantA = await createTestTenant(prisma, { slug: 'tenant-a-isolation' });
    tenantAId = tenantA.id;
    const userA = await createTestUser(prisma, tenantAId, {
      email: 'user-a@tenant-a.com',
      password: 'PassA123!',
    });
    const loginA = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ tenantId: tenantAId, email: userA.email, password: userA.password });
    tokenA = loginA.body.accessToken as string;

    // Set up Tenant B
    const tenantB = await createTestTenant(prisma, { slug: 'tenant-b-isolation' });
    tenantBId = tenantB.id;
    const userB = await createTestUser(prisma, tenantBId, {
      email: 'user-b@tenant-b.com',
      password: 'PassB123!',
    });
    const loginB = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ tenantId: tenantBId, email: userB.email, password: userB.password });
    tokenB = loginB.body.accessToken as string;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  describe('AC-018: Company isolation — Tenant A cannot see Tenant B data', () => {
    let companyAId: string;

    it('creates a company in Tenant A', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/companies')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          legalName: 'Empresa A S.A.',
          identificationType: 'JURIDICA',
          identificationNumber: '3101234500',
        })
        .expect(201);

      companyAId = response.body.id as string;
      expect(response.body.tenantId).toBe(tenantAId);
    });

    it('Tenant A can access its own company', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/companies/${companyAId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
    });

    it('Tenant B gets 404 when accessing Tenant A company', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/companies/${companyAId}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);

      expect(response.body.error.code).toBe('COMPANY_NOT_FOUND');
    });
  });

  describe('API Key isolation — Tenant A cannot see Tenant B API keys', () => {
    it('API key from Tenant A is not visible in Tenant B list', async () => {
      // Create key in Tenant A
      const createResponse = await request(app.getHttpServer())
        .post('/api/v1/api-keys')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Tenant A Key', environment: 'TEST', scopes: [] })
        .expect(201);

      const keyAId = (createResponse.body as { id: string }).id;

      // Tenant B should not see Tenant A's key in its list
      const listResponse = await request(app.getHttpServer())
        .get('/api/v1/api-keys')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);

      const keyIds = (listResponse.body as Array<{ id: string }>).map((k) => k.id);
      expect(keyIds).not.toContain(keyAId);
    });
  });
});
