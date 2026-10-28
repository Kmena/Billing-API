import { createHash } from 'crypto';
import { UnprocessableEntityException } from '@nestjs/common';
import { FiscalDocumentSnapshot } from '../../infrastructure/database/prisma-fiscal-types';
import { buildConsecutive, buildFiscalKey } from '../fiscal-documents/domain/fiscal-key.generator';
import { ScaledDecimal } from '../fiscal-documents/domain/scaled-decimal';
import { correctionLines } from './w3-a-correction-projection';

function invalid(code: string): never {
  throw new UnprocessableEntityException({ code });
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return invalid('ND_REVERSAL_SNAPSHOT_INVALID');
  return value as Record<string, unknown>;
}

function sameAmount(left: unknown, right: unknown): boolean {
  try {
    return (
      typeof left === 'string' &&
      typeof right === 'string' &&
      ScaledDecimal.from(left).toString() === ScaledDecimal.from(right).toString()
    );
  } catch {
    return false;
  }
}

/** Validates an accepted total NC against its immutable FE snapshot; no ND is emitted. */
export function assertTotalCreditNoteLab(
  invoice: FiscalDocumentSnapshot,
  credit: FiscalDocumentSnapshot,
  companyIdentificationNumber: string,
): void {
  if (
    invoice.type !== 'INVOICE' ||
    invoice.status !== 'ACCEPTED' ||
    credit.type !== 'CREDIT_NOTE' ||
    credit.status !== 'ACCEPTED' ||
    credit.sourceFiscalDocumentId !== invoice.id ||
    credit.tenantId !== invoice.tenantId ||
    credit.companyId !== invoice.companyId ||
    credit.environment !== 'SANDBOX' ||
    invoice.environment !== 'SANDBOX' ||
    credit.originConsumerId !== invoice.originConsumerId ||
    credit.originAssociationId !== invoice.originAssociationId
  )
    invalid('ND_REVERSAL_SOURCE_INVALID');

  const invoiceIssuer = object(invoice.issuerSnapshot);
  const creditIssuer = object(credit.issuerSnapshot);
  const invoiceReceiver = object(invoice.receiverSnapshot);
  const creditReceiver = object(credit.receiverSnapshot);
  if (
    invoiceIssuer.identificationNumber !== companyIdentificationNumber ||
    creditIssuer.identificationNumber !== companyIdentificationNumber ||
    invoiceReceiver.identificationNumber !== creditReceiver.identificationNumber ||
    invoiceReceiver.identificationType !== creditReceiver.identificationType
  )
    invalid('ND_REVERSAL_ISSUER_OR_RECEIVER_MISMATCH');

  const reference = object(credit.referenceSnapshot);
  if (
    reference.mode !== 'TOTAL' ||
    reference.documentTypeCode !== '01' ||
    reference.code !== '01' ||
    reference.clave !== invoice.clave ||
    reference.consecutive !== invoice.consecutive ||
    reference.issueDate !== invoice.issueDate.toISOString()
  )
    invalid('ND_REVERSAL_CREDIT_REFERENCE_INVALID');

  try {
    const consecutive = buildConsecutive({
      branchCode: credit.branchCode,
      terminalCode: credit.terminalCode,
      documentType: 'CREDIT_NOTE',
      sequenceValue: credit.sequenceValue,
    });
    const clave = buildFiscalKey({
      issuedAt: credit.issueDate,
      issuerIdentificationNumber: companyIdentificationNumber,
      consecutive,
      securityCode: credit.securityCode,
      situation: credit.situation,
    });
    if (credit.consecutive !== consecutive || credit.clave !== clave)
      invalid('ND_REVERSAL_CREDIT_IDENTITY_INVALID');
  } catch {
    invalid('ND_REVERSAL_CREDIT_IDENTITY_INVALID');
  }

  const expected = correctionLines(
    'CREDIT_NOTE',
    {
      sourceDocumentId: invoice.id,
      mode: 'TOTAL',
      referenceReasonCode: '01',
      reason: 'Validación sintética de NC total',
      externalCorrectionId: credit.id,
      correctionLines: [],
    },
    invoice.lines,
    [],
  );
  if (!Array.isArray(credit.lines) || credit.lines.length !== expected.length)
    invalid('ND_REVERSAL_CREDIT_LINES_MISMATCH');
  const fields = [
    'lineNumber',
    'sourceLineNumber',
    'cabysCode',
    'description',
    'unitMeasure',
    'quantity',
    'unitPrice',
    'discountAmount',
    'discountCode',
    'discountNature',
    'discountOther',
    'taxCode',
    'taxRateCode',
    'taxRate',
    'taxAmount',
  ];
  for (let index = 0; index < expected.length; index++) {
    const actual = object(credit.lines[index]);
    const projected = expected[index] as unknown as Record<string, unknown>;
    if (fields.some((field) => actual[field] !== projected[field]))
      invalid('ND_REVERSAL_CREDIT_LINES_MISMATCH');
  }
  const invoiceTotals = object(invoice.totals);
  const creditTotals = object(credit.totals);
  if (
    credit.currency !== invoice.currency ||
    ['grossAmount', 'discountAmount', 'taxAmount', 'totalAmount'].some(
      (field) => !sameAmount(invoiceTotals[field], creditTotals[field]),
    )
  )
    invalid('ND_REVERSAL_CREDIT_TOTALS_MISMATCH');
}

/** A reviewable candidate from the v4.4 Annex, never an issuance instruction. */
export function prepareNdReversalLab(
  invoice: FiscalDocumentSnapshot,
  credit: FiscalDocumentSnapshot,
  companyIdentificationNumber: string,
) {
  assertTotalCreditNoteLab(invoice, credit, companyIdentificationNumber);
  const preparation = {
    operation: 'REVERSE_CANCELLATION',
    sourceInvoiceId: invoice.id,
    sourceCreditNoteId: credit.id,
    reference: {
      documentTypeCode: '03',
      clave: credit.clave,
      consecutive: credit.consecutive,
      issueDate: credit.issueDate.toISOString(),
      candidateReasonCode: '01',
    },
    currency: credit.currency,
    totals: credit.totals,
    lines: credit.lines,
    fiscalPolicy: 'DF_06_REFERENCE_AND_TAX_TREATMENT_PENDING',
    issuanceAllowed: false,
  };
  return {
    ...preparation,
    snapshotSha256: createHash('sha256').update(JSON.stringify(preparation)).digest('hex'),
  };
}
