import { ScaledDecimal } from './scaled-decimal';

export interface FiscalLineTaxFields {
  readonly taxAmount?: string;
  readonly taxCode?: string;
  readonly taxRateCode?: string;
  readonly taxRate?: string;
}

export type FiscalLineTaxTreatment = 'EXEMPT' | 'ZERO_RATED' | 'TAXED';

const IVA_TAX_CODES = new Set(['01', '07']);
const SUPPORTED_TAX_CODES = new Set(['01', '07']);
const IVA_RATE_CODES = new Set(['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11']);

export function isIvaTaxCode(code: string): boolean {
  return IVA_TAX_CODES.has(code);
}

function roundedToCents(value: ScaledDecimal): string {
  const [whole, fraction] = value.toString().split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.slice(0, 2)) +
    (fraction[2] >= '5' ? 1n : 0n);
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}000`;
}

/** Shared create-time and serialization guard; never derives a tax class from amount zero. */
export function classifyFiscalLineTax(
  line: FiscalLineTaxFields,
  subtotal: ScaledDecimal,
): FiscalLineTaxTreatment {
  if (subtotal.isNegative()) throw new Error('FISCAL_XML_INVALID_BASE_AMOUNT');
  if (line.taxAmount === undefined) throw new Error('FISCAL_XML_TAX_AMOUNT_REQUIRED');
  const tax = ScaledDecimal.from(line.taxAmount);
  if (tax.isNegative()) throw new Error('FISCAL_XML_INVALID_TAX_AMOUNT');
  if (!line.taxCode) throw new Error('FISCAL_XML_TAX_METADATA_REQUIRED');
  if (!SUPPORTED_TAX_CODES.has(line.taxCode)) {
    throw new Error(`FISCAL_XML_UNSUPPORTED_TAX_CODE:${line.taxCode}`);
  }
  if (isIvaTaxCode(line.taxCode) && (!line.taxRateCode || line.taxRate === undefined)) {
    throw new Error('FISCAL_XML_IVA_RATE_CODE_REQUIRED');
  }
  if (isIvaTaxCode(line.taxCode) && !IVA_RATE_CODES.has(line.taxRateCode!)) {
    throw new Error(`FISCAL_XML_UNSUPPORTED_TAX_RATE_CODE:${line.taxRateCode}`);
  }

  const rate = ScaledDecimal.from(line.taxRate!);
  if (rate.isNegative()) throw new Error('FISCAL_XML_INVALID_TAX_RATE');
  if (line.taxCode === '01') {
    if (line.taxRateCode === '11') {
      throw new Error('FISCAL_XML_UNSUPPORTED_ZERO_TAX_TREATMENT:11');
    }
    if (line.taxRateCode === '10' || line.taxRateCode === '01') {
      if (!rate.isZero() || !tax.isZero()) {
        throw new Error('FISCAL_XML_TAX_AMOUNT_RATE_MISMATCH');
      }
      return line.taxRateCode === '10' ? 'EXEMPT' : 'ZERO_RATED';
    }
    if (tax.isZero() && !subtotal.isZero()) {
      throw new Error('FISCAL_XML_UNSUPPORTED_ZERO_TAX_TREATMENT');
    }
    // The implemented standard IVA tariffs have an explicit code-to-rate and
    // amount check. The 2-decimal alternative admits Hacienda currency rounding.
    const fraction = line.taxRateCode === '08' ? '0.13000' :
      line.taxRateCode === '04' ? '0.04000' : null;
    const percent = line.taxRateCode === '08' ? '13' :
      line.taxRateCode === '04' ? '4' : null;
    if (fraction && percent) {
      const expected = subtotal.multiply(ScaledDecimal.from(fraction));
      if (rate.toString() !== ScaledDecimal.from(percent).toString() ||
          (tax.toString() !== expected.toString() && tax.toString() !== roundedToCents(expected))) {
        throw new Error('FISCAL_XML_TAX_AMOUNT_RATE_MISMATCH');
      }
    }
  }
  if (tax.isZero() && !subtotal.isZero()) {
    throw new Error('FISCAL_XML_UNSUPPORTED_ZERO_TAX_TREATMENT');
  }
  return 'TAXED';
}
