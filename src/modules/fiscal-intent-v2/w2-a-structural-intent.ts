import { plainToInstance } from 'class-transformer';
import { validateSync, ValidationError } from 'class-validator';
import { createHash } from 'crypto';
import {
  W2AInvoiceIntentDto,
  W2AFiscalLineDto,
  W2AServicePeriodDto,
  W2ASourceReferenceDto,
} from './invoice-intent-v2.dto';

/** Deliberately distinct from the unapproved fiscal-payload.v2 hash. Never persist as a fiscal reservation. */
export const W2A_STRUCTURAL_HASH_VERSION = 'w2-a-structural.v1' as const;
const FACTOR = 10n ** 10n;
const UUID = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;

export type W2AStructuralErrorCode =
  | 'W2A_STRUCTURE_INVALID'
  | 'W2A_QUANTITY_NON_POSITIVE'
  | 'W2A_DUPLICATE_LINE'
  | 'W2A_PERIOD_INVALID'
  | 'W2A_SOURCE_EMPTY'
  | 'W2A_DISCOUNT_EXCEEDS_GROSS'
  | 'W2A_PRICE_MODE_PENDING'
  | 'W2A_ORIGIN_INVALID';

export class W2AStructuralValidationError extends Error {
  constructor(
    readonly code: W2AStructuralErrorCode,
    readonly path: string,
  ) {
    super(code);
  }
}

export interface W2ATrustedOrigin {
  tenantId: string;
  consumerId: string;
  associationId: string;
  companyId: string;
  environment: 'SANDBOX' | 'PRODUCTION';
}

export interface W2AStructuralTotals {
  /** Exact arithmetic only. Tax meaning, rounding and payable reconciliation remain pending. */
  gross: string;
  discounts: string;
  net: string;
  declaredTax: string;
  totalBeforeFiscalPolicy: string;
}

function firstValidationPath(errors: ValidationError[], parent = ''): string {
  const paths = errors.flatMap((error) => {
    const path = parent ? `${parent}.${error.property}` : error.property;
    return error.children?.length ? [firstValidationPath(error.children, path)] : [path];
  });
  return paths.sort()[0] ?? '$';
}

function normalizeDecimal(value: string): string {
  const [whole, fractional = ''] = value.split('.');
  const normalizedWhole = BigInt(whole).toString();
  const normalizedFraction = fractional.replace(/0+$/, '');
  return normalizedFraction ? `${normalizedWhole}.${normalizedFraction}` : normalizedWhole;
}

function decimalUnits(value: string): bigint {
  const [whole, fractional = ''] = normalizeDecimal(value).split('.');
  return BigInt(whole) * FACTOR + BigInt(fractional.padEnd(10, '0') || '0');
}

function formatUnits(value: bigint, scale: number): string {
  const divisor = 10n ** BigInt(scale);
  const whole = value / divisor;
  const fractional = (value % divisor).toString().padStart(scale, '0').replace(/0+$/, '');
  return fractional ? `${whole}.${fractional}` : whole.toString();
}

function validDateOnly(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function normalizePeriod(period: W2AServicePeriodDto, path: string): W2AServicePeriodDto {
  if (
    !validDateOnly(period.startsOn) ||
    !validDateOnly(period.endsOn) ||
    period.startsOn > period.endsOn
  ) {
    throw new W2AStructuralValidationError('W2A_PERIOD_INVALID', path);
  }
  return { startsOn: period.startsOn, endsOn: period.endsOn };
}

function normalizeSource(source: W2ASourceReferenceDto, path: string): W2ASourceReferenceDto {
  const normalized: W2ASourceReferenceDto = {
    ...(source.affiliationId !== undefined ? { affiliationId: source.affiliationId } : {}),
    ...(source.periodId !== undefined ? { periodId: source.periodId } : {}),
    ...(source.allocationId !== undefined ? { allocationId: source.allocationId } : {}),
    ...(source.paymentId !== undefined ? { paymentId: source.paymentId } : {}),
  };
  if (Object.keys(normalized).length === 0) {
    throw new W2AStructuralValidationError('W2A_SOURCE_EMPTY', path);
  }
  return normalized;
}

function normalizeLine(
  line: W2AFiscalLineDto,
  index: number,
): { line: W2AFiscalLineDto; gross: bigint; discounts: bigint; tax: bigint } {
  const path = `lines.${index}`;
  if (line.priceInputMode !== 'EXCLUSIVE') {
    throw new W2AStructuralValidationError('W2A_PRICE_MODE_PENDING', `${path}.priceInputMode`);
  }
  const quantity = normalizeDecimal(line.quantity);
  if (decimalUnits(quantity) === 0n) {
    throw new W2AStructuralValidationError('W2A_QUANTITY_NON_POSITIVE', `${path}.quantity`);
  }
  const unitPrice = normalizeDecimal(line.unitPrice);
  const gross = decimalUnits(quantity) * decimalUnits(unitPrice);
  let remaining = gross;
  let discounts = 0n;
  const normalizedDiscounts = line.discounts.map((discount, discountIndex) => {
    const amount = normalizeDecimal(discount.amount);
    const amountAtProductScale = decimalUnits(amount) * FACTOR;
    if (amountAtProductScale > remaining) {
      throw new W2AStructuralValidationError(
        'W2A_DISCOUNT_EXCEEDS_GROSS',
        `${path}.discounts.${discountIndex}.amount`,
      );
    }
    remaining -= amountAtProductScale;
    discounts += amountAtProductScale;
    return {
      amount,
      reasonCode: discount.reasonCode,
      ...(discount.reason !== undefined ? { reason: discount.reason } : {}),
    };
  });
  let tax = 0n;
  const normalizedTaxes = line.taxes.map((declared) => {
    const amount = normalizeDecimal(declared.amount);
    tax += decimalUnits(amount) * FACTOR;
    return {
      code: declared.code,
      rateCode: declared.rateCode,
      rate: normalizeDecimal(declared.rate),
      base: normalizeDecimal(declared.base),
      amount,
    };
  });
  return {
    line: {
      lineNumber: line.lineNumber,
      ...(line.source !== undefined
        ? { source: normalizeSource(line.source, `${path}.source`) }
        : {}),
      ...(line.servicePeriod !== undefined
        ? { servicePeriod: normalizePeriod(line.servicePeriod, `${path}.servicePeriod`) }
        : {}),
      description: line.description,
      cabysCode: line.cabysCode,
      unitCode: line.unitCode,
      quantity,
      unitPrice,
      priceInputMode: 'EXCLUSIVE',
      discounts: normalizedDiscounts,
      taxTreatment: line.taxTreatment,
      taxes: normalizedTaxes,
    },
    gross,
    discounts,
    tax,
  };
}

/** Pure structural admission. It does not validate CABYS, tax treatment, rates, payment policy or XSD. */
export function normalizeW2AInvoiceIntent(
  raw: unknown,
  documentType: 'INVOICE' | 'TICKET' = 'INVOICE',
): {
  intent: W2AInvoiceIntentDto;
  structuralTotals: W2AStructuralTotals;
} {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new W2AStructuralValidationError('W2A_STRUCTURE_INVALID', '$');
  }
  const dto = plainToInstance(W2AInvoiceIntentDto, raw);
  const errors = validateSync(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
    validationError: { target: false, value: false },
  });
  if (errors.length) {
    throw new W2AStructuralValidationError('W2A_STRUCTURE_INVALID', firstValidationPath(errors));
  }
  if (documentType === 'INVOICE' && !dto.receiver) {
    throw new W2AStructuralValidationError('W2A_STRUCTURE_INVALID', 'receiver');
  }
  const seen = new Set<number>();
  let gross = 0n;
  let discounts = 0n;
  let tax = 0n;
  const normalizedLines = dto.lines.map((line, index) => {
    if (seen.has(line.lineNumber)) {
      throw new W2AStructuralValidationError('W2A_DUPLICATE_LINE', `lines.${index}.lineNumber`);
    }
    seen.add(line.lineNumber);
    const result = normalizeLine(line, index);
    gross += result.gross;
    discounts += result.discounts;
    tax += result.tax;
    return result.line;
  });
  normalizedLines.sort((a, b) => a.lineNumber - b.lineNumber);
  const net = gross - discounts;
  const intent: W2AInvoiceIntentDto = {
    externalOperationId: dto.externalOperationId,
    policyVersion: dto.policyVersion,
    ...(dto.receiver
      ? {
          receiver: {
            identificationType: dto.receiver.identificationType,
            identificationNumber: dto.receiver.identificationNumber,
            name: dto.receiver.name,
            ...(dto.receiver.email !== undefined ? { email: dto.receiver.email } : {}),
          },
        }
      : {}),
    currency: dto.currency,
    ...(dto.exchangeRate !== undefined
      ? { exchangeRate: dto.exchangeRate === null ? null : normalizeDecimal(dto.exchangeRate) }
      : {}),
    saleCondition: dto.saleCondition,
    ...(dto.fiscalReferences !== undefined
      ? {
          fiscalReferences: dto.fiscalReferences.map((reference) => ({
            documentTypeCode: reference.documentTypeCode,
            ...(reference.documentNumber !== undefined
              ? { documentNumber: reference.documentNumber }
              : {}),
            issuedAt: new Date(reference.issuedAt).toISOString(),
            ...(reference.reasonCode !== undefined ? { reasonCode: reference.reasonCode } : {}),
            ...(reference.reason !== undefined ? { reason: reference.reason } : {}),
          })),
        }
      : {}),
    paymentMethods: dto.paymentMethods.map((payment) => ({
      code: payment.code,
      amount: normalizeDecimal(payment.amount),
    })),
    lines: normalizedLines,
  };
  return {
    intent,
    structuralTotals: {
      gross: formatUnits(gross, 20),
      discounts: formatUnits(discounts, 20),
      net: formatUnits(net, 20),
      declaredTax: formatUnits(tax, 20),
      totalBeforeFiscalPolicy: formatUnits(net + tax, 20),
    },
  };
}

function validateOrigin(origin: W2ATrustedOrigin): void {
  if (
    !origin ||
    ![origin.tenantId, origin.consumerId, origin.associationId, origin.companyId].every(
      (id) => typeof id === 'string' && UUID.test(id),
    ) ||
    !['SANDBOX', 'PRODUCTION'].includes(origin.environment)
  ) {
    throw new W2AStructuralValidationError('W2A_ORIGIN_INVALID', 'origin');
  }
}

/** Candidate hash for fixtures and comparison only; ADR-BIL-013 must approve a distinct final version. */
export function prepareW2AStructuralHash(
  raw: unknown,
  origin: W2ATrustedOrigin,
  documentType: 'INVOICE' | 'TICKET' = 'INVOICE',
) {
  validateOrigin(origin);
  const normalized = normalizeW2AInvoiceIntent(raw, documentType);
  const canonicalJson = JSON.stringify({
    version: W2A_STRUCTURAL_HASH_VERSION,
    origin: {
      tenantId: origin.tenantId,
      consumerId: origin.consumerId,
      associationId: origin.associationId,
      companyId: origin.companyId,
      environment: origin.environment,
    },
    intent: normalized.intent,
  });
  return {
    ...normalized,
    hashVersion: W2A_STRUCTURAL_HASH_VERSION,
    canonicalJson,
    sha256: createHash('sha256').update(canonicalJson, 'utf8').digest('hex'),
  };
}

/** Shape proposed for a future HTTP 400 response; no W2 endpoint uses it yet. */
export function w2AStructuralErrorBody(error: W2AStructuralValidationError, correlationId: string) {
  return {
    code: error.code,
    message: 'Invalid fiscal intent structure',
    correlationId,
    retryable: false,
    details: { path: error.path },
  };
}
