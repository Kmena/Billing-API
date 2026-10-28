import {
  BadRequestException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { FiscalDocumentLineInput } from '../fiscal-documents/application/fiscal-document.service';
import { ConsumerV2Principal } from '../fiscal-consumers/infrastructure/http/consumer-v2.guard';

export const W3_A_LAB_HASH_VERSION = 'w3-a-corrective-lab.v1' as const;
const SCALE = 100000n;
const UUID = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;

export type CorrectionKind = 'CREDIT_NOTE' | 'DEBIT_NOTE';
export interface CorrectionLineRequest {
  sourceLineNumber: number;
  quantity?: string;
  baseAmount?: string;
  commercialReference?: string;
}
export interface CorrectionIntent {
  sourceDocumentId: string;
  mode: 'TOTAL' | 'PARTIAL' | 'REMAINING' | 'ADJUSTMENT';
  referenceReasonCode: '01' | '02';
  reason: string;
  externalCorrectionId: string;
  correctionLines: CorrectionLineRequest[];
}

function invalid(code: string): never {
  throw new BadRequestException({ code });
}
function amount(value: unknown, code: string, quantity = false): bigint {
  if (
    typeof value !== 'string' ||
    !/^\d{1,13}(?:\.\d{1,5})?$/.test(value) ||
    (quantity && value.split('.')[1]?.length > 3 && !/^\d{1,3}00$/.test(value.split('.')[1] ?? ''))
  )
    return invalid(code);
  const [whole, frac = ''] = value.split('.');
  return BigInt(whole) * SCALE + BigInt(frac.padEnd(5, '0'));
}
function decimal(value: bigint): string {
  if (value < 0n) throw new ConflictException({ code: 'CORRECTION_AMOUNT_NEGATIVE' });
  return `${value / SCALE}.${(value % SCALE).toString().padStart(5, '0')}`;
}
function exact(a: bigint, b: bigint, divisor: bigint, code: string): bigint {
  const product = a * b;
  if (product % divisor !== 0n) throw new UnprocessableEntityException({ code });
  return product / divisor;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return invalid('CORRECTION_BODY_INVALID');
  return value as Record<string, unknown>;
}

/** Strict lab transport. No tax treatment is inferred from commercial references. */
export function parseCorrectionIntent(raw: unknown, kind: CorrectionKind): CorrectionIntent {
  const body = object(raw);
  const allowed = [
    'sourceDocumentId',
    'mode',
    'referenceReasonCode',
    'reason',
    'externalCorrectionId',
    'correctionLines',
  ];
  if (
    Object.keys(body).some((key) => !allowed.includes(key)) ||
    typeof body.sourceDocumentId !== 'string' ||
    !UUID.test(body.sourceDocumentId) ||
    typeof body.reason !== 'string' ||
    body.reason.trim() !== body.reason ||
    body.reason.length < 3 ||
    body.reason.length > 180 ||
    typeof body.externalCorrectionId !== 'string' ||
    !/^\S(?:.*\S)?$/.test(body.externalCorrectionId) ||
    body.externalCorrectionId.length > 128 ||
    !Array.isArray(body.correctionLines)
  ) {
    return invalid('CORRECTION_BODY_INVALID');
  }
  const mode = body.mode;
  if (
    kind === 'CREDIT_NOTE'
      ? !['TOTAL', 'PARTIAL', 'REMAINING'].includes(String(mode))
      : mode !== 'ADJUSTMENT'
  )
    return invalid('CORRECTION_MODE_INVALID');
  const referenceReasonCode = body.referenceReasonCode;
  if (referenceReasonCode !== (mode === 'TOTAL' ? '01' : '02')) {
    return invalid('CORRECTION_REFERENCE_CODE_INVALID');
  }
  if (
    body.correctionLines.length > 1000 ||
    (['TOTAL', 'REMAINING'].includes(String(mode))
      ? body.correctionLines.length !== 0
      : body.correctionLines.length === 0)
  ) {
    return invalid('CORRECTION_LINES_INVALID');
  }
  const lines = body.correctionLines.map((rawLine) => {
    const line = object(rawLine);
    if (
      Object.keys(line).some(
        (key) =>
          !['sourceLineNumber', 'quantity', 'baseAmount', 'commercialReference'].includes(key),
      ) ||
      !Number.isInteger(line.sourceLineNumber) ||
      (line.sourceLineNumber as number) < 1 ||
      (line.sourceLineNumber as number) > 1000 ||
      (line.commercialReference !== undefined &&
        (typeof line.commercialReference !== 'string' ||
          line.commercialReference.length < 1 ||
          line.commercialReference.length > 128))
    ) {
      return invalid('CORRECTION_LINE_INVALID');
    }
    if (kind === 'CREDIT_NOTE') {
      if (
        line.baseAmount !== undefined ||
        amount(line.quantity, 'CORRECTION_QUANTITY_INVALID', true) <= 0n
      ) {
        return invalid('CORRECTION_QUANTITY_INVALID');
      }
    } else if (
      line.quantity !== undefined ||
      amount(line.baseAmount, 'CORRECTION_BASE_INVALID') <= 0n
    ) {
      return invalid('CORRECTION_BASE_INVALID');
    }
    return line as unknown as CorrectionLineRequest;
  });
  if (new Set(lines.map((line) => line.sourceLineNumber)).size !== lines.length) {
    return invalid('CORRECTION_LINE_DUPLICATE');
  }
  return {
    sourceDocumentId: body.sourceDocumentId,
    mode: mode as CorrectionIntent['mode'],
    referenceReasonCode: referenceReasonCode as '01' | '02',
    reason: body.reason,
    externalCorrectionId: body.externalCorrectionId,
    correctionLines: lines.sort((a, b) => a.sourceLineNumber - b.sourceLineNumber),
  };
}

export function correctionHash(
  kind: CorrectionKind,
  intent: CorrectionIntent,
  origin: ConsumerV2Principal,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        version: W3_A_LAB_HASH_VERSION,
        kind,
        origin: {
          tenantId: origin.tenantId,
          consumerId: origin.consumerId,
          associationId: origin.associationId,
          companyId: origin.companyId,
          environment: origin.environment,
        },
        intent,
      }),
      'utf8',
    )
    .digest('hex');
}

interface LedgerLine {
  source: Record<string, unknown>;
  original: bigint;
  credited: bigint;
  remaining: bigint;
}

function correctionLedger(
  sourceLinesRaw: unknown,
  priorCreditLinesRaw: unknown[],
): Map<number, LedgerLine> {
  if (!Array.isArray(sourceLinesRaw) || sourceLinesRaw.length === 0) {
    throw new ConflictException({ code: 'CORRECTION_SOURCE_SNAPSHOT_INVALID' });
  }
  const sourceLines = sourceLinesRaw as Array<Record<string, unknown>>;
  const ledger = new Map<number, LedgerLine>();
  for (const line of sourceLines) {
    if (!Number.isInteger(line.lineNumber) || ledger.has(line.lineNumber as number)) {
      throw new ConflictException({ code: 'CORRECTION_SOURCE_SNAPSHOT_INVALID' });
    }
    const original = amount(line.quantity, 'CORRECTION_SOURCE_SNAPSHOT_INVALID');
    if (original <= 0n) throw new ConflictException({ code: 'CORRECTION_SOURCE_SNAPSHOT_INVALID' });
    ledger.set(line.lineNumber as number, {
      source: line,
      original,
      credited: 0n,
      remaining: original,
    });
  }
  for (const raw of priorCreditLinesRaw) {
    if (!Array.isArray(raw)) throw new ConflictException({ code: 'CORRECTION_LEDGER_INVALID' });
    const seen = new Set<number>();
    for (const line of raw as Array<Record<string, unknown>>) {
      const number = line.sourceLineNumber;
      if (!Number.isInteger(number) || seen.has(number as number))
        throw new ConflictException({ code: 'CORRECTION_LEDGER_INVALID' });
      seen.add(number as number);
      const current = ledger.get(number as number);
      if (!current) throw new ConflictException({ code: 'CORRECTION_LEDGER_INVALID' });
      const credited = amount(line.quantity, 'CORRECTION_LEDGER_INVALID');
      if (credited <= 0n || credited > current.remaining)
        throw new ConflictException({ code: 'CORRECTION_LEDGER_INVALID' });
      current.credited += credited;
      current.remaining -= credited;
    }
  }
  return ledger;
}

export function correctionBalances(sourceLinesRaw: unknown, priorCreditLinesRaw: unknown[]) {
  return [...correctionLedger(sourceLinesRaw, priorCreditLinesRaw)].map(
    ([sourceLineNumber, line]) => ({
      sourceLineNumber,
      originalQuantity: decimal(line.original),
      creditedQuantity: decimal(line.credited),
      remainingQuantity: decimal(line.remaining),
    }),
  );
}

export function correctionLines(
  kind: CorrectionKind,
  intent: CorrectionIntent,
  sourceLinesRaw: unknown,
  priorCreditLinesRaw: unknown[],
): FiscalDocumentLineInput[] {
  const ledger = correctionLedger(sourceLinesRaw, priorCreditLinesRaw);
  if (intent.mode === 'TOTAL' && [...ledger.values()].some((line) => line.credited > 0n)) {
    throw new ConflictException({ code: 'CORRECTION_TOTAL_AFTER_PARTIAL_UNSUPPORTED' });
  }
  const requested: CorrectionLineRequest[] =
    intent.mode === 'TOTAL'
      ? [...ledger].map(([sourceLineNumber, line]) => ({
          sourceLineNumber,
          quantity: decimal(line.original),
        }))
      : intent.mode === 'REMAINING'
        ? [...ledger]
            .filter(([, line]) => line.remaining > 0n)
            .map(([sourceLineNumber, line]) => ({
              sourceLineNumber,
              quantity: decimal(line.remaining),
            }))
        : intent.correctionLines;
  if (requested.length === 0)
    throw new ConflictException({ code: 'CORRECTION_NO_REMAINING_BALANCE' });
  return requested.map((entry, index) => {
    const balance = ledger.get(entry.sourceLineNumber);
    if (!balance) throw new BadRequestException({ code: 'CORRECTION_SOURCE_LINE_NOT_FOUND' });
    const source = balance.source;
    const sourceQuantity = balance.original;
    const sourcePrice = amount(source.unitPrice, 'CORRECTION_SOURCE_SNAPSHOT_INVALID');
    const sourceDiscount = amount(
      source.discountAmount ?? '0',
      'CORRECTION_SOURCE_SNAPSHOT_INVALID',
    );
    const rateCode = source.taxRateCode;
    if (
      source.taxCode !== '01' ||
      !['08', '10'].includes(String(rateCode)) ||
      (rateCode === '08' && source.taxRate !== '13.00000') ||
      (rateCode === '10' && source.taxRate !== '0.00000')
    ) {
      throw new UnprocessableEntityException({ code: 'CORRECTION_TAX_POLICY_PENDING' });
    }
    const quantity =
      kind === 'CREDIT_NOTE' ? amount(entry.quantity, 'CORRECTION_QUANTITY_INVALID', true) : SCALE;
    if (kind === 'CREDIT_NOTE' && quantity > balance.remaining) {
      throw new ConflictException({ code: 'CORRECTION_EXCEEDS_BALANCE' });
    }
    const unitPrice =
      kind === 'CREDIT_NOTE' ? sourcePrice : amount(entry.baseAmount, 'CORRECTION_BASE_INVALID');
    const gross = exact(quantity, unitPrice, SCALE, 'CORRECTION_PRECISION_UNSUPPORTED');
    const discount =
      kind === 'CREDIT_NOTE' && sourceDiscount > 0n
        ? exact(
            sourceDiscount,
            quantity,
            sourceQuantity,
            'CORRECTION_DISCOUNT_PRECISION_UNSUPPORTED',
          )
        : 0n;
    const net = gross - discount;
    if (net < 0n) throw new ConflictException({ code: 'CORRECTION_AMOUNT_NEGATIVE' });
    const tax =
      rateCode === '08' ? exact(net, 13n, 100n, 'CORRECTION_TAX_PRECISION_UNSUPPORTED') : 0n;
    return {
      lineNumber: index + 1,
      sourceLineNumber: entry.sourceLineNumber,
      ...(entry.commercialReference ? { commercialReference: entry.commercialReference } : {}),
      cabysCode: String(source.cabysCode),
      description: String(source.description),
      unitMeasure: String(source.unitMeasure),
      quantity: decimal(quantity),
      unitPrice: decimal(unitPrice),
      ...(discount > 0n
        ? {
            discountAmount: decimal(discount),
            discountCode: source.discountCode as string,
            discountNature: source.discountNature as string,
            ...(source.discountCode === '99'
              ? { discountOther: source.discountOther as string }
              : {}),
          }
        : {}),
      taxCode: '01',
      taxRateCode: rateCode as string,
      taxRate: rateCode === '08' ? '13.00000' : '0.00000',
      taxAmount: decimal(tax),
    };
  });
}
