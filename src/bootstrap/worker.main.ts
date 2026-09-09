import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: true,
  });

  // Graceful shutdown — NFR-007
  app.enableShutdownHooks();

  await app.init();
}

bootstrap();
