export interface TaxpayerResult {
  readonly identification: string;
  readonly name: string;
  readonly email?: string;
  readonly commercialName?: string;
  readonly found: boolean;
}

export interface ExchangeRateResult {
  readonly currency: string;
  readonly date: string;
  readonly buyRate: number;
  readonly sellRate: number;
}

export interface CabysItem {
  readonly code: string;
  readonly description: string;
  readonly taxRate: number;
  readonly category: string;
}

export interface CabysSearchResult {
  readonly items: CabysItem[];
  readonly total: number;
}

export interface SubmissionResult {
  readonly accepted: boolean;
  readonly key: string;
  readonly message?: string;
}

export interface DocumentStatusResult {
  readonly key: string;
  readonly status: 'ACCEPTED' | 'REJECTED' | 'PROCESSING' | 'NOT_FOUND';
  readonly message?: string;
  readonly haciendaTimestamp?: string;
}

/**
 * HaciendaPort — Complete interface for CR Hacienda integration.
 * Defined in Fase 0 to prevent retroactive contract changes in Fase 1+.
 * ADR-004: Abstraction isolates domain/application from Hacienda API changes.
 *
 * Phase availability:
 * - getTaxpayer, getExchangeRate, getCabys, searchCabys → Fase 1
 * - submitDocument, getDocumentStatus → Fase 2+
 */
export interface HaciendaPort {
  // ─── Public queries (Fase 1) ─────────────────────────────────────────────
  getTaxpayer(identification: string): Promise<TaxpayerResult>;
  getExchangeRate(currency: string, date: Date): Promise<ExchangeRateResult>;
  getCabys(code: string): Promise<CabysItem | null>;
  searchCabys(query: string, limit?: number): Promise<CabysSearchResult>;

  // ─── Authenticated operations (Fase 2+) ──────────────────────────────────
  submitDocument(xmlPayload: string, accessToken: string): Promise<SubmissionResult>;
  getDocumentStatus(key: string, accessToken: string): Promise<DocumentStatusResult>;
}

export const HACIENDA_PORT = Symbol('HaciendaPort');
