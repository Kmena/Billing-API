import { registerAs } from '@nestjs/config';

export interface HaciendaAuthConfig {
  idp: {
    productionTokenUrl: string;
    sandboxTokenUrl: string;
    productionClientId: string;
    sandboxClientId: string;
  };
  authTimeoutMs: number;
  tokenExpirySafetyMarginMs: number;
  retry: { count5xx: number; delay5xxMs: number };
}

export default registerAs('haciendaAuth', (): HaciendaAuthConfig => ({
  idp: {
    productionTokenUrl:
      process.env.HACIENDA_IDP_PRODUCTION_URL ??
      'https://idp.comprobanteselectronicos.go.cr/auth/realms/rut/protocol/openid-connect/token',
    sandboxTokenUrl:
      process.env.HACIENDA_IDP_SANDBOX_URL ??
      'https://idp.comprobanteselectronicos.go.cr/auth/realms/rut-stag/protocol/openid-connect/token',
    productionClientId: process.env.HACIENDA_IDP_CLIENT_ID_PRODUCTION ?? 'api-prod',
    sandboxClientId: process.env.HACIENDA_IDP_CLIENT_ID_SANDBOX ?? 'api-stag',
  },
  authTimeoutMs: parseInt(process.env.HACIENDA_AUTH_TIMEOUT_MS ?? '10000', 10),
  tokenExpirySafetyMarginMs: parseInt(
    process.env.HACIENDA_AUTH_TOKEN_EXPIRY_SAFETY_MARGIN_MS ?? '30000',
    10,
  ),
  retry: {
    count5xx: parseInt(process.env.HACIENDA_AUTH_RETRY_5XX_COUNT ?? '1', 10),
    delay5xxMs: parseInt(process.env.HACIENDA_AUTH_RETRY_5XX_DELAY_MS ?? '2000', 10),
  },
}));
