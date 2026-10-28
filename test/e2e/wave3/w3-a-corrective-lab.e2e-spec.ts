import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import * as request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { GlobalExceptionFilter } from '../../../src/api/filters/global-exception.filter';
import { configureApiPrefixes } from '../../../src/bootstrap/api-prefix';
import {
  SECRET_PROVIDER,
  SecretProvider,
} from '../../../src/infrastructure/secrets/ports/secret-provider.port';
import { STORAGE_PORT, StoragePort } from '../../../src/infrastructure/storage/ports/storage.port';
import {
  XML_SIGNER,
  XmlSignerPort,
} from '../../../src/infrastructure/signing/ports/xml-signer.port';
import { ConsumerV2LabService } from '../../../src/modules/fiscal-consumers/application/consumer-v2-lab.service';
import { createTestSigningMaterial } from '../../../src/modules/fiscal-documents/domain/fiscal-xml/__tests__/fiscal-xml-test-fixtures';
import { W3AFiscalLabModule } from '../../../src/modules/fiscal-intent-v2/w3-a-fiscal-lab.module';
import { W2B2LabInvoiceService } from '../../../src/modules/fiscal-intent-v2/w2-b2-lab-invoice.service';
import { createGuardedTestPrisma } from '../../helpers/guarded-test-prisma';
import { installGuardedTestDatabaseEnvironment } from '../../helpers/test-database-safety';
import {
  configureDefaultFiscalSetup,
  configureValidCompanyFiscalProfile,
  createEnabledHaciendaConnection,
  createFiscalTenantFixture,
  resetFiscalE2eData,
  type FiscalE2eContext,
} from '../../helpers/fiscal-e2e-helpers';

const signing = createTestSigningMaterial();
const scopes = [
  'fiscal-v2:invoices:create',
  'fiscal-v2:credit-notes:create',
  'fiscal-v2:debit-notes:create',
  'fiscal-v2:operations:read',
] as const;

function invoiceIntent(operation: string, tax: 'TAX' | 'EXEMPT' = 'TAX', mixed = false) {
  const amount = tax === 'TAX' ? '1130' : '1000';
  const result = {
    externalOperationId: operation,
    policyVersion: 'LAB_SYNTHETIC_V44_ONLY',
    receiver: {
      identificationType: 'JURIDICA',
      identificationNumber: '3101000001',
      name: 'Receptor sintético',
      email: 'receiver@example.com',
    },
    currency: 'CRC',
    saleCondition: '01',
    paymentMethods: [{ code: '01', amount }],
    lines: [
      {
        lineNumber: 1,
        source: { allocationId: operation },
        description: 'Servicio sintético',
        cabysCode: '8313100000100',
        unitCode: 'Sp',
        quantity: '2',
        unitPrice: '500',
        priceInputMode: 'EXCLUSIVE',
        discounts: [],
        taxTreatment: tax === 'TAX' ? 'LAB_TAXABLE_IVA_13_XML' : 'LAB_EXEMPT_XML',
        taxes: [
          {
            code: '01',
            rateCode: tax === 'TAX' ? '08' : '10',
            rate: tax === 'TAX' ? '13' : '0',
            base: '1000',
            amount: tax === 'TAX' ? '130' : '0',
          },
        ],
      },
    ],
  };
  if (mixed) {
    result.paymentMethods[0].amount = '1630';
    result.lines.push({
      ...result.lines[0],
      lineNumber: 2,
      quantity: '1',
      taxTreatment: 'LAB_EXEMPT_XML',
      taxes: [{ code: '01', rateCode: '10', rate: '0', base: '500', amount: '0' }],
    });
  }
  return result;
}

describe('W3-A/B synthetic corrective laboratory', () => {
  jest.setTimeout(120000);
  let app: INestApplication;
  let prisma: PrismaClient;
  let context: FiscalE2eContext;
  let lab: ConsumerV2LabService;
  let engine: W2B2LabInvoiceService;
  let tenantId: string;
  let companyId: string;
  let associationId: string;
  let apiKey: { apiKeyId: string; secret: string };
  const base = () => `/api/v2/lab/companies/${companyId}/fiscal-documents/SANDBOX`;
  const post = (path: 'credit-notes' | 'debit-notes', secret: string, key: string, body: unknown) =>
    request(app.getHttpServer())
      .post(`${base()}/${path}`)
      .set('X-API-Key', secret)
      .set('Idempotency-Key', key)
      .send(body as object);
  const credit = (
    sourceDocumentId: string,
    mode: 'TOTAL' | 'PARTIAL' | 'REMAINING',
    quantity?: string,
  ) => ({
    sourceDocumentId,
    mode,
    referenceReasonCode: mode === 'TOTAL' ? '01' : '02',
    reason: mode === 'TOTAL' ? 'Anulación sintética' : 'Corrección de monto sintética',
    externalCorrectionId: randomUUID(),
    correctionLines: mode === 'PARTIAL' ? [{ sourceLineNumber: 1, quantity }] : [],
  });
  const debit = (sourceDocumentId: string, baseAmount: string) => ({
    sourceDocumentId,
    mode: 'ADJUSTMENT',
    referenceReasonCode: '02',
    reason: 'Ajuste sintético de monto',
    externalCorrectionId: randomUUID(),
    correctionLines: [{ sourceLineNumber: 1, baseAmount }],
  });
  async function acceptedInvoice(operation: string, tax: 'TAX' | 'EXEMPT' = 'TAX', mixed = false) {
    const created = await request(app.getHttpServer())
      .post(`${base()}/invoices`)
      .set('X-API-Key', apiKey.secret)
      .set('Idempotency-Key', operation)
      .send(invoiceIntent(operation, tax, mixed))
      .expect(201);
    // Synthetic Hacienda acceptance is fixture state in the disposable database only.
    await prisma.fiscalDocument.update({
      where: { id: created.body.documentId },
      data: { status: 'ACCEPTED' },
    });
    return created.body.documentId as string;
  }

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.FISCAL_E2E_HACIENDA_SECRET ??= 'disposable-test-sentinel';
    installGuardedTestDatabaseEnvironment();
    ({ prisma } = await createGuardedTestPrisma());
    const module = await Test.createTestingModule({
      imports: [AppModule, W3AFiscalLabModule],
    }).compile();
    app = module.createNestApplication();
    configureApiPrefixes(app);
    app.useGlobalFilters(new GlobalExceptionFilter('test'));
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    context = { app, prisma, ownedTenantIds: new Set<string>() };
    lab = app.get(ConsumerV2LabService);
    engine = app.get(W2B2LabInvoiceService);
    const fixture = await createFiscalTenantFixture(context);
    tenantId = fixture.tenantId;
    companyId = fixture.companyId;
    await createEnabledHaciendaConnection(prisma, tenantId, companyId);
    await configureValidCompanyFiscalProfile(context, fixture);
    await configureDefaultFiscalSetup(context, fixture, 'INVOICE');
    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    const secretRef = `W3A_TEST_CERT_${companyId.replace(/-/g, '_')}`;
    const passRef = `W3A_TEST_PASS_${companyId.replace(/-/g, '_')}`;
    const secrets = app.get<SecretProvider>(SECRET_PROVIDER);
    await secrets.storeSecret(secretRef, JSON.stringify({ pkcs12Base64: signing.pkcs12Base64 }));
    await secrets.storeSecret(passRef, signing.certificate.passphrase);
    await prisma.fiscalSigningCertificate.create({
      data: {
        id: randomUUID(),
        tenantId,
        companyId,
        environment: 'SANDBOX',
        status: 'ACTIVE',
        certificateType: 'HACIENDA_CRYPTOGRAPHIC_KEY',
        certificateSecretReference: secretRef,
        passwordSecretReference: passRef,
        fingerprintSha256: createHash('sha256')
          .update(Buffer.from(signing.certificateDerBase64, 'base64'))
          .digest('hex'),
        serialNumber: signing.x509SerialNumber,
        subjectName: signing.x509Subject,
        issuerName: 'CN=F2.3 Test CA',
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        validTo: new Date('2027-01-01T00:00:00.000Z'),
        activeFrom: new Date('2026-01-01T00:00:00.000Z'),
        extractedIdentityNumber: company.identificationNumber,
      },
    });
    const association = await lab.registerAssociation({
      tenantId,
      companyId,
      provider: 'PARTNER',
      externalConsumerKey: 'synthetic-w3a-app',
      externalCompanyKey: 'synthetic-w3a-issuer',
      environment: 'SANDBOX',
      actorId: fixture.userId,
      correlationId: randomUUID(),
    });
    associationId = association.associationId;
    apiKey = await lab.issueKey({
      tenantId,
      associationId,
      scopes: [...scopes],
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
      actorId: fixture.userId,
      correlationId: randomUUID(),
    });
  });

  afterAll(async () => {
    if (context) await resetFiscalE2eData(context);
    await prisma?.$disconnect();
    await app?.close();
  });

  it('persists, validates and signs a total taxable NC; replays by key', async () => {
    const sourceId = await acceptedInvoice('w3a-total-source');
    const body = credit(sourceId, 'TOTAL');
    const first = await post('credit-notes', apiKey.secret, 'w3a-total', body).expect(201);
    expect(first.body).toMatchObject({ state: 'COMMITTED', documentStatus: 'READY_TO_SUBMIT' });
    const doc = await prisma.fiscalDocument.findUniqueOrThrow({
      where: { id: first.body.documentId },
      include: { xmlArtifacts: true },
    });
    expect(doc).toMatchObject({
      type: 'CREDIT_NOTE',
      sourceFiscalDocumentId: sourceId,
      originAssociationId: associationId,
    });
    expect(doc.xmlArtifacts[0].xsdValidationStatus).toBe('VALID');
    const xml = (
      await app
        .get<StoragePort>(STORAGE_PORT)
        .download(doc.xmlArtifacts[0].signedXmlStorageKey ?? '')
    ).toString('utf8');
    expect(xml).toContain('<NotaCreditoElectronica');
    expect(xml).toContain('<InformacionReferencia>');
    expect((await app.get<XmlSignerPort>(XML_SIGNER).verify(xml)).isValid).toBe(true);
    await request(app.getHttpServer())
      .get(`${base()}/corrective-notes/${doc.id}`)
      .set('X-API-Key', apiKey.secret)
      .expect(200)
      .expect(({ body: status }) => expect(status.status).toBe('READY_TO_SUBMIT'));
    await request(app.getHttpServer())
      .get(`${base()}/corrective-notes/${sourceId}`)
      .set('X-API-Key', apiKey.secret)
      .expect(404);
    const replay = await post('credit-notes', apiKey.secret, 'w3a-total', body).expect(200);
    expect(replay.body.documentId).toBe(doc.id);
    const reservation = await prisma.fiscalIdempotencyKeyV2.findFirstOrThrow({
      where: { associationId, key: 'w3a-total' },
    });
    await request(app.getHttpServer())
      .post(`${base()}/corrective-notes/lookup`)
      .set('X-API-Key', apiKey.secret)
      .send({
        type: 'CREDIT_NOTE',
        idempotencyKey: 'w3a-total',
        requestHash: reservation.requestHash,
      })
      .expect(200)
      .expect(({ body: result }) => expect(result.fiscalDocumentId).toBe(doc.id));
    await request(app.getHttpServer())
      .post(`${base()}/corrective-notes/lookup`)
      .set('X-API-Key', apiKey.secret)
      .send({ type: 'CREDIT_NOTE', idempotencyKey: 'w3a-total', requestHash: '0'.repeat(64) })
      .expect(404);
    await post('credit-notes', apiKey.secret, 'w3a-total', {
      ...body,
      reason: 'Un motivo diferente',
    }).expect(409);
    await post('credit-notes', apiKey.secret, 'w3a-total-duplicate', body).expect(409);
  });

  it('limits partial NC by remaining line quantity and serializes concurrent correction', async () => {
    const sourceId = await acceptedInvoice('w3a-partial-source');
    await post(
      'credit-notes',
      apiKey.secret,
      'w3a-partial-one',
      credit(sourceId, 'PARTIAL', '1'),
    ).expect(201);
    const second = await post(
      'credit-notes',
      apiKey.secret,
      'w3a-partial-two',
      credit(sourceId, 'PARTIAL', '1'),
    ).expect(201);
    expect(second.body.documentId).toBeTruthy();
    await post(
      'credit-notes',
      apiKey.secret,
      'w3a-partial-over',
      credit(sourceId, 'PARTIAL', '0.001'),
    ).expect(409);
    const concurrentSource = await acceptedInvoice('w3a-concurrent-source');
    const [a, b] = await Promise.all([
      post('credit-notes', apiKey.secret, 'w3a-concurrent-a', credit(concurrentSource, 'TOTAL')),
      post('credit-notes', apiKey.secret, 'w3a-concurrent-b', credit(concurrentSource, 'TOTAL')),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(
      await prisma.fiscalDocument.count({
        where: { sourceFiscalDocumentId: concurrentSource, type: 'CREDIT_NOTE' },
      }),
    ).toBe(1);
  });

  it('creates signed exempt NC and taxed/exempt ND', async () => {
    const exemptId = await acceptedInvoice('w3a-exempt-source', 'EXEMPT');
    await post(
      'credit-notes',
      apiKey.secret,
      'w3a-exempt-credit',
      credit(exemptId, 'PARTIAL', '1'),
    ).expect(201);
    const exemptDebitSource = await acceptedInvoice('w3b-exempt-debit-source', 'EXEMPT');
    const exemptDebit = await post(
      'debit-notes',
      apiKey.secret,
      'w3a-exempt-debit',
      debit(exemptDebitSource, '100'),
    ).expect(201);
    expect(
      (
        await prisma.fiscalDocument.findUniqueOrThrow({
          where: { id: exemptDebit.body.documentId },
        })
      ).type,
    ).toBe('DEBIT_NOTE');
    const taxableId = await acceptedInvoice('w3a-debit-source');
    await post('debit-notes', apiKey.secret, 'w3a-taxed-debit', debit(taxableId, '100')).expect(
      201,
    );
    const exemptTotalId = await acceptedInvoice('w3a-exempt-total-source', 'EXEMPT');
    await post(
      'credit-notes',
      apiKey.secret,
      'w3a-exempt-total',
      credit(exemptTotalId, 'TOTAL'),
    ).expect(201);
  });

  it('corrects a synthetic mixed invoice while preserving each tax treatment', async () => {
    const sourceId = await acceptedInvoice('w3a-mixed-source', 'TAX', true);
    const created = await post(
      'credit-notes',
      apiKey.secret,
      'w3a-mixed-total',
      credit(sourceId, 'TOTAL'),
    ).expect(201);
    const document = await prisma.fiscalDocument.findUniqueOrThrow({
      where: { id: created.body.documentId },
    });
    const lines = document.lines as Array<{ taxRateCode: string }>;
    expect(lines.map((line) => line.taxRateCode)).toEqual(['08', '10']);
  });

  it('rejects absent, rejected, cross-consumer, insufficient-scope and revoked sources', async () => {
    await post('credit-notes', apiKey.secret, 'w3a-absent', credit(randomUUID(), 'TOTAL')).expect(
      404,
    );
    const sourceId = await acceptedInvoice('w3a-security-source');
    await prisma.fiscalDocument.update({ where: { id: sourceId }, data: { status: 'REJECTED' } });
    await post('credit-notes', apiKey.secret, 'w3a-rejected', credit(sourceId, 'TOTAL')).expect(
      422,
    );
    await prisma.fiscalDocument.update({ where: { id: sourceId }, data: { status: 'ACCEPTED' } });
    const other = await lab.registerAssociation({
      tenantId,
      companyId,
      provider: 'AUDIT_TEST',
      externalConsumerKey: 'other-w3a-app',
      externalCompanyKey: 'same-issuer',
      environment: 'SANDBOX',
      actorId: randomUUID(),
      correlationId: randomUUID(),
    });
    const otherKey = await lab.issueKey({
      tenantId,
      associationId: other.associationId,
      scopes: [...scopes],
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
      actorId: randomUUID(),
      correlationId: randomUUID(),
    });
    await post('credit-notes', otherKey.secret, 'w3a-cross', credit(sourceId, 'TOTAL')).expect(404);
    const readOnly = await lab.issueKey({
      tenantId,
      associationId: other.associationId,
      scopes: ['fiscal-v2:operations:read'],
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
      rotationEndsAt: new Date(Date.now() + 60_000),
      actorId: randomUUID(),
      correlationId: randomUUID(),
    });
    await post('credit-notes', readOnly.secret, 'w3a-scope', credit(sourceId, 'TOTAL')).expect(403);
    await lab.revokeKey({
      tenantId,
      associationId: other.associationId,
      apiKeyId: otherKey.apiKeyId,
      actorId: randomUUID(),
      correlationId: randomUUID(),
    });
    await post('credit-notes', otherKey.secret, 'w3a-revoked', credit(sourceId, 'TOTAL')).expect(
      401,
    );
    const rotated = await lab.issueKey({
      tenantId,
      associationId,
      scopes: [...scopes],
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
      rotationEndsAt: new Date(Date.now() + 60_000),
      actorId: randomUUID(),
      correlationId: randomUUID(),
    });
    await post('credit-notes', rotated.secret, 'w3a-rotation', credit(sourceId, 'TOTAL')).expect(
      201,
    );
  });

  it('hides an original from a different company and tenant', async () => {
    const sourceId = await acceptedInvoice('w3b-foreign-company-source');
    const foreign = await createFiscalTenantFixture(context);
    const association = await lab.registerAssociation({
      tenantId: foreign.tenantId,
      companyId: foreign.companyId,
      provider: 'AUDIT_TEST',
      externalConsumerKey: 'foreign-w3b-app',
      externalCompanyKey: 'foreign-w3b-issuer',
      environment: 'SANDBOX',
      actorId: foreign.userId,
      correlationId: randomUUID(),
    });
    const key = await lab.issueKey({
      tenantId: foreign.tenantId,
      associationId: association.associationId,
      scopes: [...scopes],
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
      actorId: foreign.userId,
      correlationId: randomUUID(),
    });
    await request(app.getHttpServer())
      .post(`/api/v2/lab/companies/${foreign.companyId}/fiscal-documents/SANDBOX/credit-notes`)
      .set('X-API-Key', key.secret)
      .set('Idempotency-Key', 'w3b-foreign-company-attempt')
      .send(credit(sourceId, 'TOTAL'))
      .expect(404);
  });

  it('recovers a reserved NC and one persisted before XML without duplicate documents', async () => {
    const sourceId = await acceptedInvoice('w3a-recovery-source');
    const body = credit(sourceId, 'PARTIAL', '1');
    engine.interruptOnceAfterReservation();
    await post('credit-notes', apiKey.secret, 'w3a-recover-reserve', body).expect(503);
    const reserved = await prisma.fiscalIdempotencyKeyV2.findFirstOrThrow({
      where: { associationId, key: 'w3a-recover-reserve' },
    });
    expect(reserved.fiscalDocumentId).toBeNull();
    await post('credit-notes', apiKey.secret, 'w3a-recover-reserve', body).expect(201);
    const body2 = credit(sourceId, 'PARTIAL', '1');
    engine.interruptOnceAfterDocument();
    await post('credit-notes', apiKey.secret, 'w3a-recover-document', body2).expect(503);
    const pending = await prisma.fiscalIdempotencyKeyV2.findFirstOrThrow({
      where: { associationId, key: 'w3a-recover-document' },
    });
    expect(pending.fiscalDocumentId).toBeTruthy();
    const resumed = await post('credit-notes', apiKey.secret, 'w3a-recover-document', body2).expect(
      200,
    );
    expect(resumed.body.documentId).toBe(pending.fiscalDocumentId);
    expect(
      await prisma.fiscalDocument.count({
        where: { sourceFiscalDocumentId: sourceId, type: 'CREDIT_NOTE' },
      }),
    ).toBe(2);
  });

  it('creates an NC for the exact remaining balance after two partial NCs', async () => {
    const sourceId = await acceptedInvoice('w3b-remaining-source');
    const original = await prisma.fiscalDocument.findUniqueOrThrow({ where: { id: sourceId } });
    const a = await post(
      'credit-notes',
      apiKey.secret,
      'w3b-partial-a',
      credit(sourceId, 'PARTIAL', '0.5'),
    ).expect(201);
    const b = await post(
      'credit-notes',
      apiKey.secret,
      'w3b-partial-b',
      credit(sourceId, 'PARTIAL', '0.75'),
    ).expect(201);
    expect(a.body.documentId).not.toBe(b.body.documentId);
    await post(
      'credit-notes',
      apiKey.secret,
      'w3b-total-after-partial',
      credit(sourceId, 'TOTAL'),
    ).expect(409);
    const body = credit(sourceId, 'REMAINING');
    const result = await post('credit-notes', apiKey.secret, 'w3b-remaining', body).expect(201);
    const note = await prisma.fiscalDocument.findUniqueOrThrow({
      where: { id: result.body.documentId },
      include: { xmlArtifacts: true },
    });
    expect(note.xmlArtifacts[0].xsdValidationStatus).toBe('VALID');
    expect(note.referenceSnapshot).toMatchObject({
      code: '02',
      mode: 'REMAINING',
      priorCreditNoteIds: [a.body.documentId, b.body.documentId],
      ledgerBefore: [
        {
          sourceLineNumber: 1,
          originalQuantity: '2.00000',
          creditedQuantity: '1.25000',
          remainingQuantity: '0.75000',
        },
      ],
      ledgerAfter: [
        {
          sourceLineNumber: 1,
          originalQuantity: '2.00000',
          creditedQuantity: '2.00000',
          remainingQuantity: '0.00000',
        },
      ],
    });
    expect(note.lines).toMatchObject([{ sourceLineNumber: 1, quantity: '0.75000' }]);
    const xml = (
      await app
        .get<StoragePort>(STORAGE_PORT)
        .download(note.xmlArtifacts[0].signedXmlStorageKey ?? '')
    ).toString('utf8');
    expect((await app.get<XmlSignerPort>(XML_SIGNER).verify(xml)).isValid).toBe(true);
    const replay = await post('credit-notes', apiKey.secret, 'w3b-remaining', body).expect(200);
    expect(replay.body.documentId).toBe(note.id);
    await post('credit-notes', apiKey.secret, 'w3b-remaining', {
      ...body,
      reason: 'Otro motivo de corrección',
    }).expect(409);
    await post(
      'credit-notes',
      apiKey.secret,
      'w3b-no-balance',
      credit(sourceId, 'REMAINING'),
    ).expect(409);
    const unchanged = await prisma.fiscalDocument.findUniqueOrThrow({ where: { id: sourceId } });
    expect(unchanged.lines).toEqual(original.lines);
    expect(unchanged.status).toBe('ACCEPTED');
  });

  it('serializes two NCs competing for the same remaining balance', async () => {
    const sourceId = await acceptedInvoice('w3b-concurrent-remaining-source');
    await post(
      'credit-notes',
      apiKey.secret,
      'w3b-concurrent-prior',
      credit(sourceId, 'PARTIAL', '1'),
    ).expect(201);
    const [a, b] = await Promise.all([
      post('credit-notes', apiKey.secret, 'w3b-rem-a', credit(sourceId, 'REMAINING')),
      post('credit-notes', apiKey.secret, 'w3b-rem-b', credit(sourceId, 'REMAINING')),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(
      await prisma.fiscalDocument.count({
        where: {
          sourceFiscalDocumentId: sourceId,
          type: 'CREDIT_NOTE',
        },
      }),
    ).toBe(2);
  });

  it('recovers an interrupted ND without duplicating the correction', async () => {
    const sourceId = await acceptedInvoice('w3b-debit-recovery-source');
    const body = debit(sourceId, '100');
    engine.interruptOnceAfterDocument();
    await post('debit-notes', apiKey.secret, 'w3b-debit-recovery', body).expect(503);
    const pending = await prisma.fiscalIdempotencyKeyV2.findFirstOrThrow({
      where: { associationId, key: 'w3b-debit-recovery' },
    });
    expect(pending.fiscalDocumentId).toBeTruthy();
    const resumed = await post('debit-notes', apiKey.secret, 'w3b-debit-recovery', body).expect(
      200,
    );
    expect(resumed.body.documentId).toBe(pending.fiscalDocumentId);
    const replay = await post('debit-notes', apiKey.secret, 'w3b-debit-recovery', body).expect(200);
    expect(replay.body.documentId).toBe(resumed.body.documentId);
    expect(
      await prisma.fiscalDocument.count({
        where: { sourceFiscalDocumentId: sourceId, type: 'DEBIT_NOTE' },
      }),
    ).toBe(1);
  });

  it('blocks ND→NC and NC→ND sequences pending fiscal approval', async () => {
    const debitFirst = await acceptedInvoice('w3b-debit-first-source');
    const debitBody = debit(debitFirst, '100');
    const first = await post('debit-notes', apiKey.secret, 'w3b-debit-first', debitBody).expect(
      201,
    );
    const replay = await post('debit-notes', apiKey.secret, 'w3b-debit-first', debitBody).expect(
      200,
    );
    expect(replay.body.documentId).toBe(first.body.documentId);
    await post(
      'credit-notes',
      apiKey.secret,
      'w3b-credit-after-debit',
      credit(debitFirst, 'REMAINING'),
    ).expect(422);
    const creditFirst = await acceptedInvoice('w3b-credit-first-source');
    await post(
      'credit-notes',
      apiKey.secret,
      'w3b-credit-first',
      credit(creditFirst, 'PARTIAL', '1'),
    ).expect(201);
    await post(
      'debit-notes',
      apiKey.secret,
      'w3b-debit-after-credit',
      debit(creditFirst, '100'),
    ).expect(422);
  });
});
