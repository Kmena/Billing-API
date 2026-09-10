/**
 * HaciendaPort — Complete interface for CR Hacienda integration.
 * ADR-004: Abstraction isolates domain/application from Hacienda API changes.
 * BR-002: All field names here are Billing-owned — not Hacienda field names.
 * BR-012: No Hacienda field names (venta, compra, nombre, actividades, etc.) appear here.
 */

export interface TaxpayerActivity {
  readonly code: string; // e.g. "9609.0" — activity code (NOT a 13-digit CABYS code — BR-015)
  readonly description: string;
  readonly status: string; // "A" = active, "I" = inactive
  readonly type?: string; // "P" = principal, "S" = secondary
}

export interface TaxpayerResult {
  readonly identification: string;
  readonly name: string;
  readonly found: boolean;

  // NOT returned by /fe/ae — kept optional for future use
  readonly email?: string;
  readonly commercialName?: string;

  // Confirmed from real /fe/ae response (OQ-RA-001 resolved)
  readonly identificationType?: string; // "01"=FISICA, "02"=JURIDICA, "03"=DIMEX, "04"=NITE
  readonly taxRegime?: string; // e.g. "Régimen general"
  readonly taxSituation?: string; // "Inscrito" | "Desinscrito"
  readonly economicActivities?: readonly TaxpayerActivity[];
}

export interface ExchangeRateResult {
  readonly currency: string;
  readonly date: string; // YYYY-MM-DD — Billing-owned name (NOT Hacienda "fecha")
  readonly buyRate: number; // Billing-owned name (NOT Hacienda "compra.valor")
  readonly sellRate: number; // Billing-owned name (NOT Hacienda "venta.valor")
}

export interface CabysItem {
  readonly code: string; // 13-digit code — Billing-owned (NOT Hacienda "codigo")
  readonly description: string; // Billing-owned (NOT Hacienda "descripcion")
  readonly taxRate: number; // % — Billing-owned (NOT Hacienda "impuesto")
  readonly category: string; // most-specific breadcrumb (last element of "categorias")
}

export interface CabysSearchResult {
  readonly items: CabysItem[];
  readonly total: number; // total matching records (NOT Hacienda "cantidad" = page size)
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
 * HaciendaPort — Complete interface.
 * Phase availability:
 * - getTaxpayer, getExchangeRate, getCabys, searchCabys → Fase 1 (implemented)
 * - submitDocument, getDocumentStatus → Fase 2+ (stubs)
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
