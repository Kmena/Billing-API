import type { FiscalDocumentType, HaciendaEnvironment } from './fiscal.constants';

/** Only a total credit note in STAG may leave the synthetic test runtime. */
export function correctiveStagAllowed(type: FiscalDocumentType,
  environment: HaciendaEnvironment): boolean {
  if (environment !== 'SANDBOX') return false;
  if (process.env.NODE_ENV === 'test') return type === 'CREDIT_NOTE' || type === 'DEBIT_NOTE';
  return type === 'CREDIT_NOTE' &&
    process.env.CORRECTIVE_NOTES_STAG_ENABLED === 'true' &&
    process.env.USE_REAL_HACIENDA === 'true' &&
    process.env.EMAIL_USE_REAL === 'false' &&
    process.env.HACIENDA_RECEPCION_SANDBOX_BASE_URL ===
      'https://api-sandbox.comprobanteselectronicos.go.cr/recepcion/v1' &&
    process.env.HACIENDA_RECEPCION_PRODUCTION_BASE_URL === 'https://127.0.0.1:9/';
}
