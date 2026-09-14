/** Hacienda Connection E2E: routes require a JWT and hide credential material. */
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../../../src/app.module';
import { GlobalExceptionFilter } from '../../../src/api/filters/global-exception.filter';
import { CorrelationIdInterceptor } from '../../../src/api/interceptors/correlation-id.interceptor';
import { TenantContextInterceptor } from '../../../src/api/interceptors/tenant-context.interceptor';
import { createTestCompany, createTestTenant, createTestUser } from '../../helpers/test-factories';

describe('Hacienda Connection (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/ready', 'health/live'] });
    app.useGlobalFilters(new GlobalExceptionFilter('test'));
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalInterceptors(app.get(CorrelationIdInterceptor), app.get(TenantContextInterceptor));
    await app.init();
    prisma = new PrismaClient();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await app?.close();
  });
  it('requires JWT authentication', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/companies/00000000-0000-0000-0000-000000000000/hacienda-connection/PRODUCTION')
      .expect(401);
  });
  it('rejects an invalid environment before reaching a handler', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/companies/00000000-0000-0000-0000-000000000000/hacienda-connection/INVALID')
      .expect(401);
  });

  it('configures, reads, validates and disables a sandbox connection without exposing secrets', async () => {
    const tenant = await createTestTenant(prisma);
    const user = await createTestUser(prisma, tenant.id, {
      email: `hacienda-conn-${tenant.id.substring(0, 8)}@example.com`,
      password: 'SecurePass123!',
    });
    const company = await createTestCompany(prisma, tenant.id);

    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ tenantId: tenant.id, email: user.email, password: user.password })
      .expect(200);
    const jwtToken = loginResponse.body.accessToken as string;
    const endpoint = `/api/v1/companies/${company.id}/hacienda-connection/SANDBOX`;

    const configureResponse = await request(app.getHttpServer())
      .put(endpoint)
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ username: 'hacienda-user', password: 'hacienda-password' })
      .expect(200);

    expect(configureResponse.body.status).toBe('PENDING_VALIDATION');
    expect(configureResponse.body.secretReference).toBeUndefined();
    expect(configureResponse.body.username).toBeUndefined();
    expect(configureResponse.body.password).toBeUndefined();
    expect(configureResponse.body.accessToken).toBeUndefined();

    const getResponse = await request(app.getHttpServer())
      .get(endpoint)
      .set('Authorization', `Bearer ${jwtToken}`)
      .expect(200);

    expect(getResponse.body.status).toBe('PENDING_VALIDATION');
    expect(getResponse.body.secretReference).toBeUndefined();

    const validateResponse = await request(app.getHttpServer())
      .post(`${endpoint}/validate`)
      .set('Authorization', `Bearer ${jwtToken}`)
      .expect(200);

    expect(validateResponse.body.status).toBe('CONNECTED');
    expect(validateResponse.body.lastSuccessfulAuthAt).toBeDefined();
    expect(validateResponse.body.secretReference).toBeUndefined();

    const disableResponse = await request(app.getHttpServer())
      .delete(endpoint)
      .set('Authorization', `Bearer ${jwtToken}`)
      .expect(200);

    expect(disableResponse.body.status).toBe('DISABLED');
    expect(disableResponse.body.secretReference).toBeUndefined();
  });
});
