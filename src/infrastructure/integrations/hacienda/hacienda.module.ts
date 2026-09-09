import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HACIENDA_PORT } from './ports/hacienda.port';
import { MockHaciendaAdapter } from './adapters/mock-hacienda.adapter';
import { HaciendaApiAdapter } from './adapters/hacienda-api.adapter';

@Module({
  providers: [
    {
      provide: HACIENDA_PORT,
      useFactory: (configService: ConfigService) => {
        const nodeEnv = configService.get<string>('app.nodeEnv');
        // Use real adapter only in production with explicit flag
        if (nodeEnv === 'production' && process.env.USE_REAL_HACIENDA === 'true') {
          return new HaciendaApiAdapter();
        }
        return new MockHaciendaAdapter();
      },
      inject: [ConfigService],
    },
    MockHaciendaAdapter,
    HaciendaApiAdapter,
  ],
  exports: [HACIENDA_PORT],
})
export class HaciendaModule {}
