/** Hacienda Connection E2E: routes require a JWT and hide credential material. */
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { GlobalExceptionFilter } from '../../../src/api/filters/global-exception.filter';
import { CorrelationIdInterceptor } from '../../../src/api/interceptors/correlation-id.interceptor';
import { TenantContextInterceptor } from '../../../src/api/interceptors/tenant-context.interceptor';

describe('Hacienda Connection (E2E)', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/ready', 'health/live'] });
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalInterceptors(app.get(CorrelationIdInterceptor), app.get(TenantContextInterceptor));
    await app.init();
  });
  afterAll(async () => {
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
});
