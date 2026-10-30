import { createHash } from 'crypto';
import {
  isCanonicalHaciendaUnit,
  isHaciendaDiscountCode,
} from '../fiscal-documents/domain/fiscal-catalogs';
import { FiscalDocumentLineInput } from '../fiscal-documents/application/fiscal-document.service';
import { W2ATrustedOrigin, prepareW2AStructuralHash } from './w2-a-structural-intent';

/** Deliberately unusable as fiscal-payload.v2 until ADR-BIL-013 and issuer tax policy are approved. */
export const W2B_LAB_HASH_VERSION = 'w2-b-fiscal-lab.v1' as const;
export const W2B_LAB_TICKET_HASH_VERSION = 'w2-b-ticket-fiscal-lab.v1' as const;
export const W2B_LAB_POLICY = 'LAB_SYNTHETIC_V44_ONLY' as const;
const SCALE = 100000n;
const MAX_XML_AMOUNT = 9999999999999n * SCALE + 99999n;

export type W2BLabErrorCode =
  | 'W2B_LAB_ORIGIN_REQUIRED'
  | 'W2B_TAX_POLICY_PENDING'
  | 'W2B_ENGINE_PRECISION_UNSUPPORTED'
  | 'W2B_ENGINE_COMBINATION_UNSUPPORTED'
  | 'W2B_CABYS_STRUCTURE_INVALID'
  | 'W2B_UNIT_UNSUPPORTED'
  | 'W2B_DISCOUNT_INVALID'
  | 'W2B_TAX_BASE_MISMATCH'
  | 'W2B_TAX_AMOUNT_MISMATCH'
  | 'W2B_PAYMENT_TOTAL_MISMATCH';

export class W2BLabProjectionError extends Error {
  constructor(
    readonly code: W2BLabErrorCode,
    readonly path: string,
  ) {
    super(code);
  }
}

function units(value: string, path: string, places = 5): bigint {
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > places && /[1-9]/.test(fraction.slice(places))) {
    throw new W2BLabProjectionError('W2B_ENGINE_PRECISION_UNSUPPORTED', path);
  }
  if (BigInt(whole) > 9999999999999n) {
    throw new W2BLabProjectionError('W2B_ENGINE_PRECISION_UNSUPPORTED', path);
  }
  return BigInt(whole) * SCALE + BigInt(fraction.slice(0, 5).padEnd(5, '0') || '0');
}

function decimal(value: bigint): string {
  if (value < 0n || value > MAX_XML_AMOUNT) {
    throw new W2BLabProjectionError('W2B_ENGINE_PRECISION_UNSUPPORTED', 'amount');
  }
  return `${value / SCALE}.${(value % SCALE).toString().padStart(5, '0')}`;
}

function exactProduct(a: bigint, b: bigint, path: string): bigint {
  const product = a * b;
  if (product % SCALE !== 0n) {
    throw new W2BLabProjectionError('W2B_ENGINE_PRECISION_UNSUPPORTED', path);
  }
  return product / SCALE;
}

/** Pure, SANDBOX-only adapter to the existing FE/TE line representation. It does not authorize an issuer. */
function projectW2BDocumentLab(
  raw: unknown,
  origin: W2ATrustedOrigin,
  documentType: 'INVOICE' | 'TICKET',
) {
  if (origin?.environment !== 'SANDBOX') {
    throw new W2BLabProjectionError('W2B_LAB_ORIGIN_REQUIRED', 'origin.environment');
  }
  // Reuse W2-A validation of server-derived UUID binding and strict DTO admission.
  const { intent } = prepareW2AStructuralHash(raw, origin, documentType);
  if (
    intent.policyVersion !== W2B_LAB_POLICY ||
    intent.currency !== 'CRC' ||
    (intent.exchangeRate !== undefined &&
      intent.exchangeRate !== null &&
      intent.exchangeRate !== '1') ||
    intent.saleCondition !== '01' ||
    intent.fiscalReferences?.length
  ) {
    throw new W2BLabProjectionError('W2B_TAX_POLICY_PENDING', 'intent');
  }
  if (
    intent.paymentMethods.length !== 1 ||
    !['01', '02', '04'].includes(intent.paymentMethods[0].code)
  ) {
    throw new W2BLabProjectionError('W2B_ENGINE_COMBINATION_UNSUPPORTED', 'paymentMethods');
  }
  const lines: FiscalDocumentLineInput[] = [];
  const lineTotals: Array<{
    lineNumber: number;
    gross: string;
    discount: string;
    net: string;
    tax: string;
    total: string;
  }> = [];
  let grossTotal = 0n;
  let discountTotal = 0n;
  let taxTotal = 0n;
  for (const [index, line] of intent.lines.entries()) {
    const path = `lines.${index}`;
    if (!/^\d{13}$/.test(line.cabysCode)) {
      throw new W2BLabProjectionError('W2B_CABYS_STRUCTURE_INVALID', `${path}.cabysCode`);
    }
    if (!isCanonicalHaciendaUnit(line.unitCode)) {
      throw new W2BLabProjectionError('W2B_UNIT_UNSUPPORTED', `${path}.unitCode`);
    }
    if (line.discounts.length > 1 || line.taxes.length !== 1) {
      throw new W2BLabProjectionError('W2B_ENGINE_COMBINATION_UNSUPPORTED', path);
    }
    const quantity = units(line.quantity, `${path}.quantity`, 3);
    const unitPrice = units(line.unitPrice, `${path}.unitPrice`);
    const gross = exactProduct(quantity, unitPrice, `${path}.gross`);
    const discountInput = line.discounts[0];
    const discount = discountInput ? units(discountInput.amount, `${path}.discounts.0.amount`) : 0n;
    if (discountInput && discount === 0n) {
      throw new W2BLabProjectionError('W2B_DISCOUNT_INVALID', `${path}.discounts.0.amount`);
    }
    if (
      discountInput &&
      (!isHaciendaDiscountCode(discountInput.reasonCode) ||
        !discountInput.reason ||
        discountInput.reason.length < 3 ||
        discountInput.reason.length > 80 ||
        (discountInput.reasonCode === '99' && discountInput.reason.length < 5))
    ) {
      throw new W2BLabProjectionError('W2B_DISCOUNT_INVALID', `${path}.discounts.0`);
    }
    const net = gross - discount;
    if (net < 0n)
      throw new W2BLabProjectionError('W2B_DISCOUNT_INVALID', `${path}.discounts.0.amount`);
    const taxInput = line.taxes[0];
    const exempt = line.taxTreatment === 'LAB_EXEMPT_XML';
    if (!exempt && line.taxTreatment !== 'LAB_TAXABLE_IVA_13_XML') {
      throw new W2BLabProjectionError('W2B_TAX_POLICY_PENDING', `${path}.taxTreatment`);
    }
    if (
      taxInput.code !== '01' ||
      taxInput.rateCode !== (exempt ? '10' : '08') ||
      taxInput.rate !== (exempt ? '0' : '13')
    ) {
      throw new W2BLabProjectionError('W2B_TAX_POLICY_PENDING', `${path}.taxes.0`);
    }
    if (units(taxInput.base, `${path}.taxes.0.base`) !== net) {
      throw new W2BLabProjectionError('W2B_TAX_BASE_MISMATCH', `${path}.taxes.0.base`);
    }
    const tax = exempt ? 0n : exactProduct(net, 13000n, `${path}.taxes.0.amount`);
    if (units(taxInput.amount, `${path}.taxes.0.amount`) !== tax) {
      throw new W2BLabProjectionError('W2B_TAX_AMOUNT_MISMATCH', `${path}.taxes.0.amount`);
    }
    const projected: FiscalDocumentLineInput = {
      lineNumber: line.lineNumber,
      cabysCode: line.cabysCode,
      description: line.description,
      unitMeasure: line.unitCode,
      quantity: decimal(quantity),
      unitPrice: decimal(unitPrice),
      ...(discountInput
        ? {
            discountAmount: decimal(discount),
            discountCode: discountInput.reasonCode,
            discountNature: discountInput.reason,
            ...(discountInput.reasonCode === '99' ? { discountOther: discountInput.reason } : {}),
          }
        : {}),
      taxCode: '01',
      taxRateCode: exempt ? '10' : '08',
      taxRate: exempt ? '0.00000' : '13.00000',
      taxAmount: decimal(tax),
    };
    lines.push(projected);
    lineTotals.push({
      lineNumber: line.lineNumber,
      gross: decimal(gross),
      discount: decimal(discount),
      net: decimal(net),
      tax: decimal(tax),
      total: decimal(net + tax),
    });
    grossTotal += gross;
    discountTotal += discount;
    taxTotal += tax;
  }
  const payable = grossTotal - discountTotal + taxTotal;
  if (units(intent.paymentMethods[0].amount, 'paymentMethods.0.amount') !== payable) {
    throw new W2BLabProjectionError('W2B_PAYMENT_TOTAL_MISMATCH', 'paymentMethods.0.amount');
  }
  const totals = {
    grossAmount: decimal(grossTotal),
    discountAmount: decimal(discountTotal),
    taxAmount: decimal(taxTotal),
    totalAmount: decimal(payable),
  };
  const hashVersion =
    documentType === 'INVOICE' ? W2B_LAB_HASH_VERSION : W2B_LAB_TICKET_HASH_VERSION;
  const canonicalJson = JSON.stringify({
    version: hashVersion,
    origin: {
      tenantId: origin.tenantId,
      consumerId: origin.consumerId,
      associationId: origin.associationId,
      companyId: origin.companyId,
      environment: origin.environment,
    },
    intent,
    lineTotals,
    totals,
  });
  return {
    intent,
    lines,
    lineTotals,
    totals,
    hashVersion,
    canonicalJson,
    requestHash: createHash('sha256').update(canonicalJson, 'utf8').digest('hex'),
  };
}

export function projectW2BInvoiceLab(raw: unknown, origin: W2ATrustedOrigin) {
  return projectW2BDocumentLab(raw, origin, 'INVOICE');
}

export function projectW2BTicketLab(raw: unknown, origin: W2ATrustedOrigin) {
  return projectW2BDocumentLab(raw, origin, 'TICKET');
}
