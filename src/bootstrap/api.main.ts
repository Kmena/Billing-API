import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from '../app.module';
import { GlobalExceptionFilter } from '../api/filters/global-exception.filter';
import { CorrelationIdInterceptor } from '../api/interceptors/correlation-id.interceptor';
import { TenantContextInterceptor } from '../api/interceptors/tenant-context.interceptor';
import { AuditInterceptor } from '../api/interceptors/audit.interceptor';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

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
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Billing API')
      .setDescription('Billing SaaS — Facturación Electrónica Costa Rica')
      .setVersion('0.1.0')
      .addBearerAuth()
      .addApiKey({ type: 'apiKey', in: 'header', name: 'X-API-Key' }, 'X-API-Key')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  // Graceful shutdown — NFR-007
  app.enableShutdownHooks();

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
}

bootstrap();
