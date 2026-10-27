import { Controller, Get, INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { configureApiPrefixes } from '../api-prefix';

@Controller('route-probe')
class V1ProbeController {
  @Get()
  get() {
    return { version: 'v1' };
  }
}

@Controller('api/v2/route-probe')
class V2ProbeController {
  @Get()
  get() {
    return { version: 'v2' };
  }
}

@Module({ controllers: [V1ProbeController, V2ProbeController] })
class ProbeModule {}

describe('API prefix coexistence before v2 activation', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
    app = module.createNestApplication();
    configureApiPrefixes(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('keeps existing unversioned controllers under /api/v1', async () => {
    await request(app.getHttpServer()).get('/api/v1/route-probe').expect(200, { version: 'v1' });
    await request(app.getHttpServer()).get('/route-probe').expect(404);
  });

  it('leaves an explicitly versioned v2 controller at /api/v2 only', async () => {
    await request(app.getHttpServer()).get('/api/v2/route-probe').expect(200, { version: 'v2' });
    await request(app.getHttpServer()).get('/api/v1/api/v2/route-probe').expect(404);
  });
});
