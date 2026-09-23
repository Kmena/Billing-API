/**
 * Parser for Hacienda MensajeHacienda XML responses.
 *
 * Hacienda schema namespace:
 *   https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/mensajeHacienda
 *
 * SAFETY CONTRACT:
 *   - Only allowlisted text elements are extracted (see SAFE_ELEMENTS).
 *   - ds:Signature and all cryptographic data are NEVER extracted or exposed.
 *   - Taxpayer identification numbers are NOT extracted (not needed for diagnostics).
 *   - All returned text values are sanitized before leaving this module.
 *   - parseError signals a parsing problem but MUST NOT block callers' state transitions.
 *     The authoritative fiscal decision always comes from the GET transport (ind-estado),
 *     never from the content of the parsed XML.
 */

export interface HaciendaFiscalResponseDiagnostic {
  /**
   * Numeric Hacienda response code returned inside <Mensaje>.
   * "1" = comprobante aceptado
   * "2" = comprobante aceptado con advertencias
   * "3" = comprobante rechazado
   */
  readonly mensaje?: string;
  /**
   * Human-readable rejection / acceptance reason from <DetalleMensaje>.
   * Sanitized: entity-decoded, control-chars removed, length-bounded to 500.
   */
  readonly detalleMensaje?: string;
  /**
   * String form of the fiscal decision from <EstadoMensaje>: e.g. "Rechazado".
   * Sanitized: length-bounded to 100.
   */
  readonly estadoMensaje?: string;
}

export interface HaciendaFiscalResponseParseResult {
  readonly diagnostic: HaciendaFiscalResponseDiagnostic;
  /**
   * Set when the input is not recognisable as MensajeHacienda or extraction
   * found no safe elements.  Callers MUST NOT block their state transition on this.
   */
  readonly parseError?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MENSAJEHACIENDA_MARKER = 'MensajeHacienda';
const MENSAJEHACIENDA_NS_FRAGMENT = 'comprobanteselectronicos.go.cr';
const DETALLE_MAX_LENGTH = 500;
const SHORT_MAX_LENGTH = 100;

/** Allowlisted local element names.  ds:Signature is intentionally absent. */
const SAFE_ELEMENTS = ['Mensaje', 'DetalleMensaje', 'EstadoMensaje'] as const;
type SafeElement = (typeof SAFE_ELEMENTS)[number];

// ── Extraction ────────────────────────────────────────────────────────────────

/**
 * Extracts plain text content of the first matching XML element by local name.
 *
 * Matches both unprefixed (<Mensaje>) and prefixed (<ns:Mensaje>) forms.
 * Will NOT match elements whose name contains the target as a substring,
 * because the regex anchors on the full name with > delimiter.
 *
 * ds:Signature uses only prefixed sub-elements (SignedInfo, SignatureValue, …)
 * that are not in SAFE_ELEMENTS, so they are naturally skipped.
 */
function extractElement(xml: string, localName: string): string | undefined {
  const re = new RegExp(
    `<(?:[a-zA-Z0-9]+:)?${localName}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[a-zA-Z0-9]+:)?${localName}>`,
  );
  const m = xml.match(re);
  return m ? m[1] : undefined;
}

// ── Sanitisation ──────────────────────────────────────────────────────────────

/**
 * Decodes XML character references and the five predefined XML entities.
 * Does NOT parse nested tags or CDATA sections.
 */
function decodeXmlEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/**
 * Sanitises a text value extracted from MensajeHacienda XML.
 *
 * Rules applied in order:
 *   1. Decode XML entities  (&#13; → CR, &amp; → & …)
 *   2. Normalise line endings  (\r\n and bare \r → \n)
 *   3. Strip ANSI / VT escape sequences  (\x1b[…m)
 *   4. Remove other control chars except \n (LF) and \t (TAB)
 *   5. Strip residual XML / HTML tags  (<…> → removed)
 *   6. Collapse 3 or more consecutive blank lines to 2
 *   7. Trim leading / trailing whitespace
 *   8. Bound to maxLength characters
 */
function sanitizeText(raw: string, maxLength: number): string {
  return decodeXmlEntities(raw)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\x1b\[[0-9;]*[mGKHFJABCDsu]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxLength);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Parses a Hacienda MensajeHacienda XML response and returns safe fiscal
 * result fields.
 *
 * The raw artifact is NEVER modified.
 * On parse failure, returns `{ diagnostic: {}, parseError: '<reason>' }`.
 * Callers MUST continue their state transition regardless of parseError.
 */
export function parseMensajeHacienda(xml: Buffer | string): HaciendaFiscalResponseParseResult {
  const xmlStr = Buffer.isBuffer(xml) ? xml.toString('utf8') : xml;

  if (
    !xmlStr.includes(MENSAJEHACIENDA_MARKER) ||
    !xmlStr.includes(MENSAJEHACIENDA_NS_FRAGMENT)
  ) {
    return { diagnostic: {}, parseError: 'INPUT_NOT_MENSAJEHACIENDA' };
  }

  const extracted: Partial<Record<SafeElement, string>> = {};
  for (const name of SAFE_ELEMENTS) {
    const raw = extractElement(xmlStr, name);
    if (raw !== undefined) extracted[name] = raw;
  }

  if (Object.keys(extracted).length === 0) {
    return { diagnostic: {}, parseError: 'NO_SAFE_ELEMENTS_FOUND' };
  }

  const diagnostic: HaciendaFiscalResponseDiagnostic = {
    ...(extracted.Mensaje !== undefined
      ? { mensaje: sanitizeText(extracted.Mensaje, SHORT_MAX_LENGTH) }
      : {}),
    ...(extracted.DetalleMensaje !== undefined
      ? { detalleMensaje: sanitizeText(extracted.DetalleMensaje, DETALLE_MAX_LENGTH) }
      : {}),
    ...(extracted.EstadoMensaje !== undefined
      ? { estadoMensaje: sanitizeText(extracted.EstadoMensaje, SHORT_MAX_LENGTH) }
      : {}),
  };

  return { diagnostic };
}
