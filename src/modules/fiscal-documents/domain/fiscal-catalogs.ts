/**
 * Hacienda v4.4 fiscal catalogs used by Billing's public fiscal API.
 *
 * Source: resources/hacienda/v4.4/FacturaElectronica.xsd
 * - UnidadMedidaType
 * - CodigoDescuentoType
 *
 * Keep this small on purpose: Billing accepts canonical Hacienda values only.
 * Inventori owns commercial-unit mapping and must send these canonical values.
 */

export const H4_UNIT_MEASURES = ['Unid', 'Kg', 'G', 'L', 'mL', 'M', 'Sp'] as const;
export type H4UnitMeasure = (typeof H4_UNIT_MEASURES)[number];

export const H4_DISCOUNT_CODES = [
  '01',
  '02',
  '03',
  '04',
  '05',
  '06',
  '07',
  '08',
  '09',
  '99',
] as const;
export type H4DiscountCode = (typeof H4_DISCOUNT_CODES)[number];

export const INVENTORI_P0_UNIT_MAPPING = {
  UN: 'Unid',
  KG: 'Kg',
  kg: 'Kg',
  G: 'G',
  L: 'L',
  ML: 'mL',
  M: 'M',
  service: 'Sp',
} as const;

export function isCanonicalHaciendaUnit(value: string): value is H4UnitMeasure {
  return (H4_UNIT_MEASURES as readonly string[]).includes(value);
}

export function isHaciendaDiscountCode(value: string): value is H4DiscountCode {
  return (H4_DISCOUNT_CODES as readonly string[]).includes(value);
}
