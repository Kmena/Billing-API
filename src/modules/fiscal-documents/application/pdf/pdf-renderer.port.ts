/**
 * PdfRendererPort — F4 PDF rendering abstraction.
 *
 * All PDF rendering goes through this port. No vendor PDF library leaks to application code.
 * Input is immutable fiscal evidence only — no mutable business data.
 * QR payload comes from QrContentBuilderPort (already built).
 * Template controlled by Billing (BILLING_DEFAULT_V1 for MVP).
 *
 * Official requirements enforced by adapters:
 * - QR lower-right area (DGT-R-000-2024)
 * - QR ≥ 2.5 cm × 2.5 cm (DGT-R-000-2024)
 * - Tipo de documento + Clave + consecutivo grouped (Anexos Note 1)
 * - All content legible
 * - No external network resource loading
 * - Render timeout and memory limits enforced
 */

export interface ImmutableFiscalDocumentView {
  readonly type: 'INVOICE' | 'TICKET';
  /** Exactly 50 numeric digits — immutable Clave. */
  readonly clave: string;
  readonly consecutive: string;
  readonly issueDate: Date;
  readonly issuerSnapshot: Record<string, unknown>;
  readonly receiverSnapshot: Record<string, unknown> | null;
  readonly lineItems: ReadonlyArray<Record<string, unknown>>;
  readonly totals: Record<string, unknown>;
  readonly currency: string;
  readonly exchangeRate?: number;
  readonly saleCondition: string;
  readonly paymentMethod: string;
}

export interface CompanyBrandingView {
  readonly templateId: string;
  /** Validated, sanitized logo bytes. Magic-byte validated. No SVG. */
  readonly logoBytes?: Buffer;
  readonly logoContentType?: string;
  /** Hex color code (#RRGGBB). */
  readonly primaryColor?: string;
  /** Hex color code (#RRGGBB). */
  readonly secondaryColor?: string;
  readonly footerText?: string;
  readonly showCommercialName: boolean;
  readonly commercialName?: string;
}

export interface PdfRendererInput {
  /** Immutable fiscal document view — no mutable data. */
  readonly document: ImmutableFiscalDocumentView;
  /** Safe branding view — cannot override mandatory fiscal content. */
  readonly branding: CompanyBrandingView;
  /** Built by QrContentBuilderPort from immutable Clave. */
  readonly qrPayload: string;
  /** Template identifier. MVP: 'BILLING_DEFAULT_V1'. */
  readonly templateId: string;
  /** Semver renderer version for artifact metadata. */
  readonly rendererVersion: string;
}

export interface PdfRendererOutput {
  readonly bytes: Buffer;
  readonly contentType: 'application/pdf';
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly templateId: string;
  readonly rendererVersion: string;
}

export interface PdfRendererPort {
  /**
   * Render a fiscal PDF from immutable evidence.
   *
   * @param input - Immutable fiscal view + safe branding + QR payload.
   * @returns Rendered PDF bytes with integrity metadata.
   *
   * Implementations must:
   * - Use immutable evidence only (no mutable DB reads).
   * - Enforce render timeout (configurable, default 30s).
   * - Enforce memory limits.
   * - Not load external network resources.
   * - Produce deterministic output for identical inputs.
   */
  render(input: PdfRendererInput): Promise<PdfRendererOutput>;
}

export const PDF_RENDERER = Symbol('PdfRendererPort');
