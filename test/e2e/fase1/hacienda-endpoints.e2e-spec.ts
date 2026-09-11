/**
 * E2E Tests — Fase 1: Hacienda integration endpoints (mock adapter)
 * Covers: FR-001, FR-004, FR-005, BR-010, DEC-003, DEC-004
 *
 * Uses MockHaciendaAdapter — no external calls.
 * Uses a database-backed API key to exercise validation after authentication.
 * These tests cover route registration, validation, and 401/400 behavior.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { PrismaService } from '../../../src/infrastructure/database/prisma.service';
import { createTestApiKey } from '../../helpers/test-factories';
import { CorrelationIdInterceptor } from '../../../src/api/interceptors/correlation-id.interceptor';
import { GlobalExceptionFilter } from '../../../src/api/filters/global-exception.filter';

async function createTestApp(): Promise<INestApplication> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/ready', 'health/live'] });
  app.useGlobalFilters(new GlobalExceptionFilter('test'));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalInterceptors(app.get(CorrelationIdInterceptor));
  try {
    await app.init();
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}

describe('Hacienda Endpoints (E2E — mock)', () => {
  let app: INestApplication;
  let apiKey: string;

  beforeAll(async () => {
    app = await createTestApp();
    apiKey = await createTestApiKey(app.get(PrismaService), [
      'taxpayers:read',
      'cabys:read',
      'exchange-rates:read',
    ]);
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('GET /api/v1/taxpayers/:identification', () => {
    it('FR-006: rejects identification shorter than 9 digits with 400', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/taxpayers/12345678') // 8 digits = invalid
        .set('X-API-Key', apiKey)
        .expect(400);
      expect(res.body.error.code).toBe('BAD_REQUEST');
    });

    it('FR-006: rejects identification with letters with 400', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/taxpayers/310123456A')
        .set('X-API-Key', apiKey)
        .expect(400);
      expect(res.body).toBeDefined();
    });

    it('AC-015: returns 401 (no API key) rather than exposing taxpayer data', async () => {
      await request(app.getHttpServer()).get('/api/v1/taxpayers/3101234567').expect(401);
    });
  });

  describe('GET /api/v1/cabys', () => {
    it('BR-010: rejects search query shorter than 3 chars with 400', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/cabys?search=ab') // 2 chars = invalid
        .set('X-API-Key', apiKey)
        .expect(400);
      expect(res.body).toBeDefined();
    });

    it('AC-015: returns 401 when no API key supplied', async () => {
      await request(app.getHttpServer()).get('/api/v1/cabys?search=servicios').expect(401);
    });
  });

  describe('GET /api/v1/cabys/:code', () => {
    it('AC-021: rejects CABYS code that is not exactly 13 digits with 400', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/cabys/52099') // too short
        .set('X-API-Key', apiKey)
        .expect(400);
      expect(res.body).toBeDefined();
    });
  });

  describe('GET /api/v1/exchange-rates', () => {
    it('AC-015: returns 401 when no API key supplied', async () => {
      await request(app.getHttpServer()).get('/api/v1/exchange-rates').expect(401);
    });

    it('returns 400 for invalid date format', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/exchange-rates?date=not-a-date')
        .set('X-API-Key', apiKey)
        .expect(400);
    });
  });
});
