import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from '../app.module';
import { GlobalExceptionFilter } from '../api/filters/global-exception.filter';
import { CorrelationIdInterceptor } from '../api/interceptors/correlation-id.interceptor';
import { TenantContextInterceptor } from '../api/interceptors/tenant-context.interceptor';
import { AuditInterceptor } from '../api/interceptors/audit.interceptor';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  const configService = app.get(ConfigService);
  const nodeEnv = configService.get<string>('NODE_ENV', 'development');

  // CORS — FR-010: configurable via CORS_ALLOWED_ORIGINS (comma-separated list).
  // The Joi validation schema (config.validation-schema.ts) enforces that production
  // and staging environments must provide an explicit non-wildcard origin, so by the
  // time we reach this point the value is guaranteed to be safe.
  const corsOrigins = configService.get<string>('CORS_ALLOWED_ORIGINS', '*');
  app.enableCors({
    origin: corsOrigins === '*' ? true : corsOrigins.split(',').map((s) => s.trim()),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-API-Key',
      'X-Correlation-ID',
      'Idempotency-Key',
    ],
    exposedHeaders: [
      'X-Correlation-ID',
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
    ],
    credentials: corsOrigins !== '*',
    maxAge: 86400, // preflight cache: 24 hours
  });

  // Global API prefix — all endpoints under /api/v1
  app.setGlobalPrefix('api/v1', {
    exclude: ['health', 'health/ready', 'health/live'],
  });

  // Global exception filter — FR-014
  app.useGlobalFilters(new GlobalExceptionFilter());

  // Global validation pipe — FR from architecture § 8
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Global interceptors via DI — NestJS resolves AuditService through the container
  // CorrelationId → TenantContext → Audit (order is important)
  const { HttpAdapterHost } = await import('@nestjs/core');
  void HttpAdapterHost; // imported to ensure core is loaded

  app.useGlobalInterceptors(
    app.get(CorrelationIdInterceptor),
    app.get(TenantContextInterceptor),
    app.get(AuditInterceptor),
  );

  // OpenAPI/Swagger — FR-016: only in non-production environments
  if (nodeEnv !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Billing API')
      .setDescription(
        [
          'Billing SaaS — Facturación Electrónica Costa Rica.',
          '',
          '## Authentication',
          '- **JWT Bearer token** — for management endpoints (companies, api-keys, tenants).',
          '- **X-API-Key header** — for integration endpoints (taxpayers, cabys, exchange-rates).',
          '',
          '## Scopes (API Key)',
          '| Scope | Endpoint |',
          '|---|---|',
          '| `taxpayers:read` | GET /api/v1/taxpayers/:identification |',
          '| `cabys:read` | GET /api/v1/cabys/:code, GET /api/v1/cabys?search= |',
          '| `exchange-rates:read` | GET /api/v1/exchange-rates |',
          '',
          '## Rate Limiting',
          '- API Key endpoints: 100 requests/minute per key.',
          '- Auth endpoints (login/refresh): 10 requests/minute per IP.',
        ].join('\n'),
      )
      .setVersion('1.0.0')
      .setContact('Billing Support', 'https://billing.example.com', 'support@billing.example.com')
      .setLicense('Proprietary', 'https://billing.example.com/license')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        'BearerAuth',
      )
      .addApiKey({ type: 'apiKey', in: 'header', name: 'X-API-Key' }, 'X-API-Key')
      .addTag('Health', 'Service health and readiness')
      .addTag('Authentication', 'JWT authentication — login and refresh')
      .addTag('Tenants', 'Tenant management (requires Bearer token)')
      .addTag('Companies', 'Company management (requires Bearer token)')
      .addTag('API Keys', 'API key management (requires Bearer token)')
      .addTag('Taxpayers', 'Hacienda taxpayer lookup (requires X-API-Key with taxpayers:read)')
      .addTag('CABYS', 'CABYS catalogue lookup (requires X-API-Key with cabys:read)')
      .addTag('Exchange Rates', 'Hacienda exchange rates (requires X-API-Key with exchange-rates:read)')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
        tagsSorter: 'alpha',
        operationsSorter: 'alpha',
      },
    });
  }

  // Graceful shutdown — NFR-007
  app.enableShutdownHooks();

  const port = configService.get<number>('PORT') ?? 3000;
  await app.listen(port);
}

bootstrap();
