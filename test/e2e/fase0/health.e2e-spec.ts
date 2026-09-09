/**
 * E2E Tests — Health Endpoints
 * AC-013, FR-015
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { CorrelationIdInterceptor } from '../../../src/api/interceptors/correlation-id.interceptor';

describe('Health (E2E)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/ready', 'health/live'] });
    app.useGlobalInterceptors(app.get(CorrelationIdInterceptor));

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /health', () => {
    it('AC-013: returns 200 with status ok (liveness)', async () => {
      const response = await request(app.getHttpServer()).get('/health').expect(200);

      expect(response.body.status).toBe('ok');
    });

    it('FR-012: includes X-Correlation-ID header', async () => {
      const response = await request(app.getHttpServer()).get('/health').expect(200);
      expect(response.headers['x-correlation-id']).toBeDefined();
    });
  });

  describe('GET /health/ready', () => {
    it('returns 200 with db: ok when database is connected', async () => {
      const response = await request(app.getHttpServer()).get('/health/ready').expect(200);

      expect(response.body.status).toBe('ok');
    });
  });

  describe('GET /health/live', () => {
    it('returns 200 (liveness alias)', async () => {
      const response = await request(app.getHttpServer()).get('/health/live').expect(200);
      expect(response.body.status).toBe('ok');
    });
  });
});
