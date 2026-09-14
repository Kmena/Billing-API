export const FISCAL_SPEC_VERSION = 'Hacienda CR electronic documents v4.4';
export const FISCAL_COUNTRY_CODE = '506';
export const FISCAL_NORMAL_SITUATION = '1';
export const DEFAULT_BRANCH_CODE = '001';
export const DEFAULT_TERMINAL_CODE = '00001';

export const FISCAL_DOCUMENT_CODES = {
  INVOICE: '01',
  TICKET: '04',
} as const;

export const ALLOWED_CURRENCY_CODES = ['CRC', 'USD'] as const;
export const ALLOWED_SALE_CONDITIONS = [
  '01',
  '02',
  '03',
  '04',
  '05',
  '06',
  '07',
  '08',
  '09',
  '10',
  '11',
  '12',
  '99',
] as const;
export const ALLOWED_PAYMENT_METHODS = ['01', '02', '03', '04', '05', '99'] as const;

export type FiscalDocumentType = keyof typeof FISCAL_DOCUMENT_CODES;
export type HaciendaEnvironment = 'PRODUCTION' | 'SANDBOX';
