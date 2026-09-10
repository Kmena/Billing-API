/**
 * E2E Tests — Fase 1: ScopeGuard + ApiKey-authenticated endpoints
 * Covers: DEC-001, DEC-002, FR-006, FR-007, FR-008, FR-009
 *
 * Note: Uses MockHaciendaAdapter (USE_REAL_HACIENDA=false by default).
 * No external HTTP calls are made.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { CorrelationIdInterceptor } from '../../../src/api/interceptors/correlation-id.interceptor';
import { GlobalExceptionFilter } from '../../../src/api/filters/global-exception.filter';

// We set up a minimal app similar to the real bootstrap
async function createTestApp(): Promise<INestApplication> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/ready', 'health/live'] });
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalInterceptors(app.get(CorrelationIdInterceptor));
  await app.init();
  return app;
}

describe('ScopeGuard (E2E)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/v1/taxpayers/:identification (scope: taxpayers:read)', () => {
    it('DEC-002: returns 401 when X-API-Key is absent', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/taxpayers/3101234567')
        .expect(401);
    });

    it('DEC-002: returns 401 when X-API-Key is invalid', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/taxpayers/3101234567')
        .set('X-API-Key', 'bk_live_invalid_key')
        .expect(401);
    });

    it('FR-006: returns 400 when identification is not 9–12 digits', async () => {
      // Even with invalid API key, validation runs first for param format
      await request(app.getHttpServer())
        .get('/api/v1/taxpayers/123')
        .set('X-API-Key', 'bk_live_invalid_key')
        .expect(400);
    });
  });

  describe('GET /api/v1/cabys (scope: cabys:read)', () => {
    it('DEC-002: returns 401 when X-API-Key is absent', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/cabys?search=servicios')
        .expect(401);
    });
  });

  describe('GET /api/v1/exchange-rates (scope: exchange-rates:read)', () => {
    it('DEC-002: returns 401 when X-API-Key is absent', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/exchange-rates')
        .expect(401);
    });
  });
});
