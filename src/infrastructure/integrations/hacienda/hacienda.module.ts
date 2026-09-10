import { Module, Logger } from '@nestjs/common';
import { HttpModule, HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { CacheModule, CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { HACIENDA_PORT } from './ports/hacienda.port';
import { MockHaciendaAdapter } from './adapters/mock-hacienda.adapter';
import { HaciendaApiAdapter } from './adapters/hacienda-api.adapter';
import { HaciendaCircuitBreaker } from './hacienda-circuit-breaker.service';

@Module({
  imports: [
    HttpModule,
    CacheModule.register({ ttl: 3600000, max: 500 }), // default TTL 1h, 500 entries max
  ],
  providers: [
    HaciendaCircuitBreaker,
    MockHaciendaAdapter,
    HaciendaApiAdapter,
    {
      provide: HACIENDA_PORT,
      useFactory: (
        configService: ConfigService,
        httpService: HttpService,
        cache: Cache,
        circuitBreaker: HaciendaCircuitBreaker,
      ) => {
        const useReal = configService.get<boolean>('hacienda.useReal') ?? false;
        const apiBaseUrl =
          configService.get<string>('hacienda.apiBaseUrl') ?? 'https://api.hacienda.go.cr';

        const adapterName = useReal ? 'HaciendaApiAdapter' : 'MockHaciendaAdapter';
        new Logger('HaciendaModule').log(
          `Adapter: ${adapterName} (USE_REAL_HACIENDA=${useReal ? 'true' : 'false'}, baseUrl=${apiBaseUrl})`,
        );

        if (useReal) {
          return new HaciendaApiAdapter(configService, httpService, cache, circuitBreaker);
        }
        return new MockHaciendaAdapter();
      },
      inject: [ConfigService, HttpService, CACHE_MANAGER, HaciendaCircuitBreaker],
    },
  ],
  exports: [HACIENDA_PORT, HaciendaCircuitBreaker],
})
export class HaciendaModule {}
