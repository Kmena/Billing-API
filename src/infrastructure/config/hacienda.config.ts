import { registerAs } from '@nestjs/config';

export interface HaciendaConfig {
  apiBaseUrl: string;
  timeoutMs: number;
  useReal: boolean;
  cache: {
    taxpayerTtlMs: number;
    exchangeRateTtlMs: number;
    cabysItemTtlMs: number;
    cabysSearchTtlMs: number;
  };
  circuitBreaker: {
    failureThreshold: number;
    resetTimeoutMs: number;
    outboundRatePerSecond: number;
  };
  retry: {
    count429: number;
    baseDelay429Ms: number;
    count5xx: number;
    delay5xxMs: number;
  };
}

export default registerAs('hacienda', (): HaciendaConfig => ({
  apiBaseUrl: process.env.HACIENDA_API_BASE_URL ?? 'https://api.hacienda.go.cr',
  timeoutMs: parseInt(process.env.HACIENDA_TIMEOUT_MS ?? '10000', 10),
  useReal: process.env.USE_REAL_HACIENDA === 'true',
  cache: {
    taxpayerTtlMs: parseInt(process.env.TAXPAYER_CACHE_TTL_MS ?? '3600000', 10),
    exchangeRateTtlMs: parseInt(process.env.EXCHANGE_RATE_CACHE_TTL_MS ?? '14400000', 10),
    cabysItemTtlMs: parseInt(process.env.CABYS_ITEM_CACHE_TTL_MS ?? '86400000', 10),
    cabysSearchTtlMs: parseInt(process.env.CABYS_SEARCH_CACHE_TTL_MS ?? '3600000', 10),
  },
  circuitBreaker: {
    failureThreshold: parseInt(process.env.HACIENDA_CB_FAILURE_THRESHOLD ?? '5', 10),
    resetTimeoutMs: parseInt(process.env.HACIENDA_CB_RESET_TIMEOUT_MS ?? '30000', 10),
    outboundRatePerSecond: parseInt(process.env.HACIENDA_CB_OUTBOUND_RATE_PER_SECOND ?? '8', 10),
  },
  retry: {
    count429: parseInt(process.env.HACIENDA_RETRY_429_COUNT ?? '2', 10),
    baseDelay429Ms: parseInt(process.env.HACIENDA_RETRY_429_BASE_DELAY_MS ?? '1000', 10),
    count5xx: parseInt(process.env.HACIENDA_RETRY_5XX_COUNT ?? '1', 10),
    delay5xxMs: parseInt(process.env.HACIENDA_RETRY_5XX_DELAY_MS ?? '2000', 10),
  },
}));
