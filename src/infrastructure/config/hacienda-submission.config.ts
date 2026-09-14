import { registerAs } from '@nestjs/config';

export interface HaciendaSubmissionConfig {
  readonly productionBaseUrl: string;
  readonly sandboxBaseUrl: string;
  readonly timeoutMs: number;
  readonly callbackUrl?: string;
}

export default registerAs('haciendaSubmission', (): HaciendaSubmissionConfig => {
  const callbackUrl = process.env.HACIENDA_SUBMISSION_CALLBACK_URL?.trim();

  return {
    productionBaseUrl:
      process.env.HACIENDA_RECEPCION_PRODUCTION_BASE_URL ??
      'https://api.comprobanteselectronicos.go.cr/recepcion/v1/',
    sandboxBaseUrl:
      process.env.HACIENDA_RECEPCION_SANDBOX_BASE_URL ??
      'https://api.comprobanteselectronicos.go.cr/recepcion-sandbox/v1/',
    timeoutMs: Number(process.env.HACIENDA_SUBMISSION_TIMEOUT_MS ?? '15000'),
    callbackUrl: callbackUrl === '' ? undefined : callbackUrl,
  };
});
