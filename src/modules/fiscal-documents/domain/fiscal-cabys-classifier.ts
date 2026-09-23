/**
 * CAByS goods/service classification.
 *
 * Source: Hacienda v4.4 CAByS taxonomy structure.
 * The 13-digit CAByS code's first digit encodes the top-level product category:
 *   0–4 → goods (bienes / mercancías)
 *   5–9 → services (servicios)
 *
 * This rule is reflected in the XSD ResumenFactura structure, which uses separate
 * total fields for goods (TotalMercanciasGravadas) and services (TotalServGravados).
 *
 * Fails closed: any non-13-digit string is rejected immediately — the caller must
 * validate the CAByS code before classifying.
 */
export type CabysCategory = 'GOODS' | 'SERVICE';

export function classifyCabys(code: string): CabysCategory {
  if (!/^\d{13}$/.test(code)) {
    throw new Error('INVALID_CABYS_CODE');
  }
  return parseInt(code[0], 10) >= 5 ? 'SERVICE' : 'GOODS';
}
