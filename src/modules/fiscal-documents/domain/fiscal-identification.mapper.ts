const HACIENDA_XML_IDENTIFICATION_CODES: Record<string, string> = {
  FISICA: '01',
  JURIDICA: '02',
  DIMEX: '03',
  NITE: '04',
};

export function mapIdentificationTypeToXmlCode(value: string): string {
  const normalized = value.trim().toUpperCase();
  const code = HACIENDA_XML_IDENTIFICATION_CODES[normalized] ?? normalized;
  if (!['01', '02', '03', '04'].includes(code)) {
    throw new Error('FISCAL_IDENTIFICATION_TYPE_UNSUPPORTED');
  }
  return code;
}

export function normalizeIssuerIdentificationForClave(value: string): string {
  const normalized = value.trim();
  if (!/^\d{1,12}$/.test(normalized)) {
    throw new Error('FISCAL_IDENTIFICATION_NUMBER_INVALID_FOR_CLAVE');
  }
  return normalized.padStart(12, '0');
}
