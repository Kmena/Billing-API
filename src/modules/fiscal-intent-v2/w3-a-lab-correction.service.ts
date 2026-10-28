import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaTransactionClient } from '../../infrastructure/database/prisma-fiscal-types';
import {
  FiscalDocumentService,
  CreateFiscalDocumentCommand,
} from '../fiscal-documents/application/fiscal-document.service';
import { ConsumerV2Principal } from '../fiscal-consumers/infrastructure/http/consumer-v2.guard';
import { ConsumerV2LabService } from '../fiscal-consumers/application/consumer-v2-lab.service';
import { FiscalEvidenceResolverService } from '../fiscal-documents/application/artifacts/fiscal-evidence-resolver.service';
import { W2B2LabInvoiceService } from './w2-b2-lab-invoice.service';
import {
  CorrectionKind,
  correctionBalances,
  correctionHash,
  correctionLines,
  debitAdjustmentBalances,
  parseCorrectionIntent,
  validateCorrectionSourceReference,
  W3_A_LAB_HASH_VERSION,
} from './w3-a-correction-projection';

type Tx = PrismaTransactionClient;

/** Laboratory-only corrective flow. The W2 reservation/XML engine owns recovery and signing. */
@Injectable()
export class W3ALabCorrectionService {
  constructor(
    private readonly documents: FiscalDocumentService,
    private readonly operations: W2B2LabInvoiceService,
    private readonly consumers: ConsumerV2LabService,
    private readonly evidence: FiscalEvidenceResolverService,
  ) {}

  async create(
    kind: CorrectionKind,
    input: {
      principal: ConsumerV2Principal;
      idempotencyKey: string;
      intent: unknown;
      correlationId: string;
    },
  ) {
    if (process.env.NODE_ENV !== 'test' || input.principal.environment !== 'SANDBOX') {
      throw new ForbiddenException({ code: 'W3_A_LAB_ONLY' });
    }
    const intent = parseCorrectionIntent(input.intent, kind);
    const requestHash = correctionHash(kind, intent, input.principal);
    return this.operations.executePrepared(input, {
      operation: kind === 'CREDIT_NOTE' ? 'CREATE_CREDIT_NOTE' : 'CREATE_DEBIT_NOTE',
      scope:
        kind === 'CREDIT_NOTE' ? 'fiscal-v2:credit-notes:create' : 'fiscal-v2:debit-notes:create',
      hashVersion: W3_A_LAB_HASH_VERSION,
      requestHash,
      abortOnBusinessError: true,
      createDocument: (tx) =>
        this.createCorrectiveDocument(tx, kind, intent, input.principal, requestHash),
    });
  }

  getDocument(principal: ConsumerV2Principal, documentId: string) {
    return this.operations.getDocument(principal, documentId, ['CREDIT_NOTE', 'DEBIT_NOTE']);
  }

  async signedXml(principal: ConsumerV2Principal, documentId: string) {
    // The origin-bound read must succeed before the tenant-scoped artifact resolver is called.
    await this.getDocument(principal, documentId);
    return this.evidence.resolveSignedXmlBytes(principal.tenantId, principal.companyId, documentId);
  }

  lookup(
    principal: ConsumerV2Principal,
    kind: CorrectionKind,
    idempotencyKey: string,
    requestHash: string,
    correlationId: string,
  ) {
    return this.consumers.lookupOperation({
      principal,
      operation: kind === 'CREDIT_NOTE' ? 'CREATE_CREDIT_NOTE' : 'CREATE_DEBIT_NOTE',
      idempotencyKey,
      requestHashVersion: W3_A_LAB_HASH_VERSION,
      requestHash,
      correlationId,
    });
  }

  private async createCorrectiveDocument(
    tx: Tx,
    kind: CorrectionKind,
    intent: ReturnType<typeof parseCorrectionIntent>,
    p: ConsumerV2Principal,
    requestHash: string,
  ) {
    // The source lock serializes balance calculation across distinct idempotency keys.
    await tx.$queryRaw`SELECT id FROM fiscal_documents WHERE id = ${intent.sourceDocumentId}::uuid FOR UPDATE`;
    const source = await tx.fiscalDocument.findFirst({
      where: {
        id: intent.sourceDocumentId,
        tenantId: p.tenantId,
        companyId: p.companyId,
        environment: 'SANDBOX',
        type: 'INVOICE',
        originConsumerId: p.consumerId,
        originAssociationId: p.associationId,
        disposedAt: null,
      },
    });
    if (!source) throw new NotFoundException({ code: 'CORRECTION_SOURCE_NOT_FOUND' });
    if (source.status !== 'ACCEPTED') {
      throw new UnprocessableEntityException({ code: 'CORRECTION_SOURCE_NOT_ACCEPTED' });
    }
    if (!source.receiverSnapshot || !source.requestHash) {
      throw new UnprocessableEntityException({ code: 'CORRECTION_SOURCE_UNSUPPORTED' });
    }
    const issuer = source.issuerSnapshot;
    const company = await tx.company.findUnique({
      where: { id: p.companyId },
      select: { identificationNumber: true },
    });
    if (
      !company ||
      !issuer ||
      typeof issuer !== 'object' ||
      Array.isArray(issuer) ||
      issuer.identificationNumber !== company.identificationNumber
    ) {
      throw new UnprocessableEntityException({ code: 'CORRECTION_ISSUER_CHANGED' });
    }
    validateCorrectionSourceReference(source, company.identificationNumber);
    const sourceXml = await tx.fiscalXmlArtifact.findFirst({
      where: {
        fiscalDocumentId: source.id,
        tenantId: p.tenantId,
        companyId: p.companyId,
        xsdValidationStatus: 'VALID',
        signedXmlStorageKey: { not: null },
        signatureVerifiedAt: { not: null },
      },
      select: { id: true },
    });
    if (!sourceXml)
      throw new UnprocessableEntityException({ code: 'CORRECTION_SOURCE_XML_UNVERIFIED' });
    const correctiveDocuments = await tx.fiscalDocument.findMany({
      where: {
        sourceFiscalDocumentId: source.id,
        tenantId: p.tenantId,
        companyId: p.companyId,
        type: { in: ['CREDIT_NOTE', 'DEBIT_NOTE'] },
        status: { not: 'REJECTED' },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, type: true, lines: true, referenceSnapshot: true },
    });
    if (
      correctiveDocuments.some((note) => {
        const reference = note.referenceSnapshot;
        return (
          reference &&
          typeof reference === 'object' &&
          !Array.isArray(reference) &&
          reference.externalCorrectionId === intent.externalCorrectionId
        );
      })
    )
      throw new ConflictException({ code: 'CORRECTION_EXTERNAL_ID_DUPLICATE' });
    const credits = correctiveDocuments.filter((note) => note.type === 'CREDIT_NOTE');
    const debits = correctiveDocuments.filter((note) => note.type === 'DEBIT_NOTE');
    if (
      (kind === 'CREDIT_NOTE' && debits.length > 0) ||
      (kind === 'DEBIT_NOTE' && credits.length > 0)
    ) {
      throw new UnprocessableEntityException({ code: 'CORRECTION_MIXED_NOTE_POLICY_PENDING' });
    }
    const creditedLines = credits.map((note) => note.lines);
    const adjustedLines = debits.map((note) => note.lines);
    const ledgerBefore = correctionBalances(source.lines, creditedLines);
    const debitLedgerBefore = debitAdjustmentBalances(source.lines, adjustedLines);
    const lines = correctionLines(kind, intent, source.lines, creditedLines);
    if (lines.length === 0) throw new ConflictException({ code: 'CORRECTION_EMPTY' });
    const command: CreateFiscalDocumentCommand = {
      tenantId: p.tenantId,
      companyId: p.companyId,
      environment: 'SANDBOX',
      type: kind,
      receiver: source.receiverSnapshot as Record<string, unknown>,
      currency: source.currency,
      exchangeRate: source.exchangeRate?.toString(),
      saleCondition: source.saleCondition,
      creditTermDays: source.creditTermDays ?? undefined,
      paymentMethod: source.paymentMethod ?? undefined,
      lines,
    };
    return this.documents.createCorrectiveDocumentV3LabInTransaction(
      tx,
      command,
      requestHash,
      { consumerId: p.consumerId, associationId: p.associationId },
      {
        sourceFiscalDocumentId: source.id,
        referenceSnapshot: {
          documentTypeCode: '01',
          clave: source.clave,
          consecutive: source.consecutive,
          issueDate: source.issueDate.toISOString(),
          code: intent.referenceReasonCode,
          reason: intent.reason,
          externalCorrectionId: intent.externalCorrectionId,
          mode: intent.mode,
          priorCreditNoteIds: credits.map((note) => note.id),
          priorDebitNoteIds: debits.map((note) => note.id),
          ledgerBefore,
          ...(kind === 'CREDIT_NOTE'
            ? { ledgerAfter: correctionBalances(source.lines, [...creditedLines, lines]) }
            : {
                debitLedgerBefore,
                debitLedgerAfter: debitAdjustmentBalances(source.lines, [...adjustedLines, lines]),
              }),
        },
      },
    );
  }
}
