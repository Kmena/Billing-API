import { createHash } from 'crypto';
import { ScaledDecimal } from '../domain/scaled-decimal';
import type {
  CreateFiscalDocumentCommand,
  FiscalDocumentLineInput,
} from './fiscal-document.service';

export const FISCAL_PAYLOAD_EQUIVALENCE_CONTRACT_VERSION = 'fiscal-payload-equivalence.v1' as const;

export interface FiscalPayloadEquivalenceInput {
  readonly receiver?: Record<string, unknown> | null;
  readonly currency: string;
  readonly exchangeRate?: string | null;
  readonly saleCondition: string;
  readonly creditTermDays?: number | null;
  readonly paymentMethod?: string | null;
  readonly lines: readonly FiscalDocumentLineInput[];
}

type CanonicalJson =
  null | boolean | number | string | CanonicalJson[] | { [key: string]: CanonicalJson };

/**
 * Independent versioned fiscal-payload evidence. Its SHA-256 is deliberately
 * limited to the fiscal payload so an external caller can reproduce it. Tenant,
 * company, environment, and type are authenticated lookup/create scope and are
 * bound separately; they are never caller-supplied hash material. Billing's
 * internal idempotency request hash remains unchanged.
 */
export function canonicalFiscalPayload(input: FiscalPayloadEquivalenceInput): CanonicalJson {
  return {
    contractVersion: FISCAL_PAYLOAD_EQUIVALENCE_CONTRACT_VERSION,
    fiscalPayload: {
      receiver: normalizeJsonValue(input.receiver ?? null, 'receiver'),
      currency: requireText(input.currency, 'currency'),
      exchangeRate: normalizeOptionalDecimal(input.exchangeRate),
      saleCondition: requireText(input.saleCondition, 'saleCondition'),
      creditTermDays: normalizeOptionalInteger(input.creditTermDays, 'creditTermDays'),
      paymentMethod: normalizeOptionalText(input.paymentMethod),
      lines: input.lines.map((line) => canonicalLine(line)),
    },
  };
}

export function canonicalFiscalPayloadString(input: FiscalPayloadEquivalenceInput): string {
  return stableStringify(canonicalFiscalPayload(input));
}

export function canonicalFiscalPayloadHash(input: FiscalPayloadEquivalenceInput): string {
  return createHash('sha256').update(canonicalFiscalPayloadString(input), 'utf8').digest('hex');
}

export function fiscalPayloadInputFromCommand(
  command: CreateFiscalDocumentCommand,
): FiscalPayloadEquivalenceInput {
  return {
    receiver: command.receiver ?? null,
    currency: command.currency,
    exchangeRate: command.exchangeRate ?? null,
    saleCondition: command.saleCondition,
    creditTermDays: command.creditTermDays ?? null,
    paymentMethod: command.paymentMethod ?? null,
    lines: command.lines,
  };
}

export function fiscalPayloadInputFromStoredDocument(document: {
  readonly receiverSnapshot: unknown;
  readonly currency: string;
  readonly exchangeRate: unknown;
  readonly saleCondition: string;
  readonly creditTermDays: number | null;
  readonly paymentMethod: string | null;
  readonly lines: unknown;
}): FiscalPayloadEquivalenceInput {
  if (!Array.isArray(document.lines)) throw new Error('stored fiscal lines are invalid');
  if (
    document.receiverSnapshot !== null &&
    (typeof document.receiverSnapshot !== 'object' || Array.isArray(document.receiverSnapshot))
  ) {
    throw new Error('stored fiscal receiver is invalid');
  }
  return {
    receiver: document.receiverSnapshot as Record<string, unknown> | null,
    currency: document.currency,
    exchangeRate: document.exchangeRate === null ? null : String(document.exchangeRate),
    saleCondition: document.saleCondition,
    creditTermDays: document.creditTermDays,
    paymentMethod: document.paymentMethod,
    lines: document.lines as FiscalDocumentLineInput[],
  };
}

export function stableStringify(value: CanonicalJson): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number')
    return JSON.stringify(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(',')}}`;
}

function canonicalLine(line: FiscalDocumentLineInput): CanonicalJson {
  return {
    lineNumber: normalizeInteger(line.lineNumber, 'lineNumber'),
    cabysCode: requireText(line.cabysCode, 'cabysCode'),
    description: requireText(line.description, 'description'),
    unitMeasure: requireText(line.unitMeasure, 'unitMeasure'),
    quantity: normalizeDecimal(line.quantity, 'quantity'),
    unitPrice: normalizeDecimal(line.unitPrice, 'unitPrice'),
    discountAmount: normalizeOptionalDecimal(line.discountAmount),
    discountCode: normalizeOptionalText(line.discountCode),
    discountNature: normalizeOptionalText(line.discountNature),
    discountOther: normalizeOptionalText(line.discountOther),
    taxAmount: normalizeOptionalDecimal(line.taxAmount),
    taxCode: normalizeOptionalText(line.taxCode),
    taxRateCode: normalizeOptionalText(line.taxRateCode),
    taxRate: normalizeOptionalDecimal(line.taxRate),
  };
}

function normalizeJsonValue(value: unknown, path: string): CanonicalJson {
  if (value === null) return null;
  if (typeof value === 'string') return normalizeDate(value, path);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path} must be finite`);
    return value;
  }
  if (Array.isArray(value))
    return value.map((item, index) => normalizeJsonValue(item, `${path}[${index}]`));
  if (typeof value !== 'object') throw new Error(`${path} is not JSON-compatible`);

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, normalizeJsonValue(nested, key)]),
  ) as { [key: string]: CanonicalJson };
}

function normalizeDate(value: string, field: string): string {
  if (!/(date|at)$/i.test(field)) return value;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${field} must be an ISO date or timestamp`);
  return parsed.toISOString();
}

function normalizeDecimal(value: string, field: string): string {
  try {
    return ScaledDecimal.from(value).toString();
  } catch {
    throw new Error(`${field} must be a decimal with up to five fractional digits`);
  }
}

function normalizeOptionalDecimal(value: string | null | undefined): string | null {
  return value === null || value === undefined ? null : normalizeDecimal(value, 'decimal');
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  return value === null || value === undefined ? null : requireText(value, 'text');
}

function normalizeOptionalInteger(value: number | null | undefined, field: string): number | null {
  return value === null || value === undefined ? null : normalizeInteger(value, field);
}

function normalizeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value)) throw new Error(`${field} must be a safe integer`);
  return value;
}

function requireText(value: string, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${field} is required`);
  return value;
}
