import { UnprocessableEntityException } from '@nestjs/common';
import { FiscalDocumentSnapshot } from '../../infrastructure/database/prisma-fiscal-types';
import { ScaledDecimal } from '../fiscal-documents/domain/scaled-decimal';
import { ConsumerV2Principal } from '../fiscal-consumers/infrastructure/http/consumer-v2.guard';
import { projectW2BInvoiceLab, W2B_LAB_POLICY } from './w2-b-lab-projection';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new UnprocessableEntityException({ code: 'REPLACEMENT_SOURCE_UNSUPPORTED' });
  return value as Record<string, unknown>;
}

function required(value: unknown): string {
  if (typeof value !== 'string' || !value.trim())
    throw new UnprocessableEntityException({ code: 'REPLACEMENT_SOURCE_UNSUPPORTED' });
  return value.trim();
}

/** Rebuild only the admitted W2 laboratory subset from immutable fiscal snapshots. */
export function replacementDraftFromInvoice(
  source: FiscalDocumentSnapshot,
  workflowId: string,
  principal: ConsumerV2Principal,
) {
  if (source.type !== 'INVOICE' || source.status !== 'ACCEPTED' || !Array.isArray(source.lines))
    throw new UnprocessableEntityException({ code: 'REPLACEMENT_SOURCE_UNSUPPORTED' });
  const receiver = record(source.receiverSnapshot);
  const totals = record(source.totals);
  const intent = {
    externalOperationId: `replacement-${workflowId}`,
    policyVersion: W2B_LAB_POLICY,
    receiver: {
      identificationType: required(receiver.identificationType),
      identificationNumber: required(receiver.identificationNumber),
      name: required(receiver.name),
      email: required(receiver.email),
    },
    currency: required(source.currency),
    saleCondition: required(source.saleCondition),
    paymentMethods: [
      { code: required(source.paymentMethod), amount: required(totals.totalAmount) },
    ],
    lines: source.lines.map((raw) => {
      const line = record(raw);
      const quantity = required(line.quantity);
      const unitPrice = required(line.unitPrice);
      const discountAmount = typeof line.discountAmount === 'string' ? line.discountAmount : '0';
      const taxRateCode = required(line.taxRateCode);
      if (required(line.taxCode) !== '01' || !['08', '10'].includes(taxRateCode))
        throw new UnprocessableEntityException({ code: 'REPLACEMENT_SOURCE_UNSUPPORTED' });
      const base = ScaledDecimal.from(quantity)
        .multiply(ScaledDecimal.from(unitPrice))
        .subtract(ScaledDecimal.from(discountAmount));
      return {
        lineNumber: line.lineNumber,
        description: required(line.description),
        cabysCode: required(line.cabysCode),
        unitCode: required(line.unitMeasure),
        quantity,
        unitPrice,
        priceInputMode: 'EXCLUSIVE',
        discounts: ScaledDecimal.from(discountAmount).isZero()
          ? []
          : [
              {
                amount: discountAmount,
                reasonCode: required(line.discountCode),
                reason: required(line.discountNature),
              },
            ],
        taxTreatment: taxRateCode === '08' ? 'LAB_TAXABLE_IVA_13_XML' : 'LAB_EXEMPT_XML',
        taxes: [
          {
            code: '01',
            rateCode: taxRateCode,
            rate: required(line.taxRate),
            base: base.toString(),
            amount: required(line.taxAmount),
          },
        ],
      };
    }),
  };
  try {
    return projectW2BInvoiceLab(intent, {
      tenantId: principal.tenantId,
      companyId: principal.companyId,
      consumerId: principal.consumerId,
      associationId: principal.associationId,
      environment: 'SANDBOX',
    }).intent;
  } catch {
    throw new UnprocessableEntityException({ code: 'REPLACEMENT_SOURCE_UNSUPPORTED' });
  }
}

export function validateReplacementConfirmation(
  raw: unknown,
  expectedExternalOperationId: string,
  principal: ConsumerV2Principal,
) {
  const projected = projectW2BInvoiceLab(raw, {
    tenantId: principal.tenantId,
    companyId: principal.companyId,
    consumerId: principal.consumerId,
    associationId: principal.associationId,
    environment: 'SANDBOX',
  });
  if (projected.intent.externalOperationId !== expectedExternalOperationId)
    throw new UnprocessableEntityException({ code: 'REPLACEMENT_OPERATION_ID_IMMUTABLE' });
  return projected.intent;
}
