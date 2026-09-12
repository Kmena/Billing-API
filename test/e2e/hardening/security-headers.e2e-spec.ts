import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import helmet from 'helmet';
import { AppModule } from '../../../src/app.module';

/**
 * E2E Tests — HTTP Security Headers (AUD-SEC01)
 *
 * Existing E2E suites bootstrap Nest applications directly instead of importing
 * src/bootstrap/api.main.ts. This test applies the same Helmet configuration used
 * by api.main.ts so response-header behavior is covered in the E2E environment.
 */
describe('HTTP Security Headers (AUD-SEC01)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(
      helmet({
        contentSecurityPolicy: false,
      }),
    );

    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('includes x-content-type-options: nosniff', async () => {
    const response = await request(app.getHttpServer()).get('/health').expect(200);

    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('removes x-powered-by header', async () => {
    const response = await request(app.getHttpServer()).get('/health').expect(200);

    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('includes x-dns-prefetch-control', async () => {
    const response = await request(app.getHttpServer()).get('/health').expect(200);

    expect(response.headers['x-dns-prefetch-control']).toBeDefined();
  });

  it('includes strict-transport-security', async () => {
    const response = await request(app.getHttpServer()).get('/health').expect(200);

    expect(response.headers['strict-transport-security']).toBeDefined();
  });
});
