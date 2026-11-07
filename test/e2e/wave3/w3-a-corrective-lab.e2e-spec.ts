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
  XSD_VALIDATOR,
  XsdValidatorPort,
} from '../../../src/modules/fiscal-documents/application/fiscal-xml/xsd-validator.port';
import {
  buildConsecutive,
  buildFiscalKey,
} from '../../../src/modules/fiscal-documents/domain/fiscal-key.generator';
import { FiscalXmlDocumentSnapshot } from '../../../src/modules/fiscal-documents/domain/fiscal-xml/fiscal-xml.types';
import { HaciendaV44XmlSerializerAdapter } from '../../../src/modules/fiscal-documents/infrastructure/xml/hacienda-v44-xml-serializer.adapter';
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
  'fiscal-v2:tickets:create',
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
  let adminUserId: string;
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
  const requireCreated = (response: Awaited<ReturnType<typeof post>>) => {
    if (response.status !== 201) {
      const value = String(response.body?.error?.code ?? response.body?.state ?? 'UNKNOWN');
      const code = /^[A-Z0-9_]{1,80}$/.test(value) ? value : 'UNKNOWN';
      throw new Error(`W3_EXPECTED_201_GOT_${response.status}_${code}`);
    }
    return response;
  };
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
  const cancellationBase = () => `${base()}/cancellations`;
  const cancelInvoice = (sourceDocumentId: string, key: string, secret = apiKey.secret) =>
    request(app.getHttpServer())
      .post(cancellationBase())
      .set('X-API-Key', secret)
      .set('Idempotency-Key', key)
      .send({ sourceDocumentId, reason: 'Anulación total solicitada por operador' });
  const workflowPost = (
    workflowId: string,
    suffix: string,
    key: string,
    body: object = {},
    secret = apiKey.secret,
  ) =>
    request(app.getHttpServer())
      .post(`${cancellationBase()}/${workflowId}/${suffix}`)
      .set('X-API-Key', secret)
      .set('Idempotency-Key', key)
      .send(body);
  const workflowGet = (workflowId: string, suffix = '', secret = apiKey.secret) =>
    request(app.getHttpServer())
      .get(`${cancellationBase()}/${workflowId}${suffix}`)
      .set('X-API-Key', secret);
  async function acceptedInvoice(operation: string, tax: 'TAX' | 'EXEMPT' = 'TAX', mixed = false) {
    const created = requireCreated(
      await request(app.getHttpServer())
        .post(`${base()}/invoices`)
        .set('X-API-Key', apiKey.secret)
        .set('Idempotency-Key', operation)
        .send(invoiceIntent(operation, tax, mixed)),
    );
    // Synthetic Hacienda acceptance is fixture state in the disposable database only.
    await prisma.fiscalDocument.update({
      where: { id: created.body.documentId },
      data: { status: 'ACCEPTED' },
    });
    return created.body.documentId as string;
  }

  function discountedIntent(operation: string) {
    const intent = invoiceIntent(operation, 'TAX', true);
    return {
      ...intent,
      paymentMethods: [{ code: '01', amount: '1517' }],
      lines: [
        {
          ...intent.lines[0],
          discounts: [{ amount: '100', reasonCode: '07', reason: 'Descuento comercial' }],
          taxes: [{ code: '01', rateCode: '08', rate: '13', base: '900', amount: '117' }],
        },
        intent.lines[1],
      ],
    };
  }

  async function acceptedDiscountedTicket(operation: string) {
    const { receiver: _receiver, ...body } = discountedIntent(operation);
    const created = await request(app.getHttpServer())
      .post(`${base()}/tickets`)
      .set('X-API-Key', apiKey.secret)
      .set('Idempotency-Key', operation)
      .send(body)
      .expect(201);
    await prisma.fiscalDocument.update({
      where: { id: created.body.documentId },
      data: { status: 'ACCEPTED' },
    });
    return created.body.documentId as string;
  }

  async function acceptedDiscountedInvoice(operation: string) {
    const created = await request(app.getHttpServer())
      .post(`${base()}/invoices`)
      .set('X-API-Key', apiKey.secret)
      .set('Idempotency-Key', operation)
      .send(discountedIntent(operation))
      .expect(201);
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
    adminUserId = fixture.userId;
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

  it('cancels an accepted discounted TE by one signed total NC with TE reference', async () => {
    const sourceId = await acceptedDiscountedTicket('front-a-ticket-discount');
    const first = await cancelInvoice(sourceId, 'front-a-ticket-cancel').expect(200);
    const noteId = first.body.cancellationNoteId as string;
    const note = await prisma.fiscalDocument.findUniqueOrThrow({
      where: { id: noteId },
      include: { xmlArtifacts: true },
    });
    expect(note).toMatchObject({
      type: 'CREDIT_NOTE',
      sourceFiscalDocumentId: sourceId,
      receiverSnapshot: null,
      referenceSnapshot: { documentTypeCode: '04' },
    });
    expect(note.xmlArtifacts[0].xsdValidationStatus).toBe('VALID');
    const xml = (
      await app
        .get<StoragePort>(STORAGE_PORT)
        .download(note.xmlArtifacts[0].signedXmlStorageKey ?? '')
    ).toString('utf8');
    expect(xml).toContain('<TipoDocIR>04</TipoDocIR>');
    expect(xml).toContain('<MontoDescuento>100.00000</MontoDescuento>');
    expect((await app.get<XmlSignerPort>(XML_SIGNER).verify(xml)).isValid).toBe(true);
    const downloaded = await request(app.getHttpServer())
      .get(`${base()}/corrective-notes/${noteId}/signed-xml`)
      .set('X-API-Key', apiKey.secret)
      .expect(200);
    const bytes = Buffer.isBuffer(downloaded.body)
      ? downloaded.body
      : Buffer.from(downloaded.text, 'utf8');
    expect(bytes.toString('utf8')).toBe(xml);
    expect(downloaded.headers['x-content-sha256']).toBe(
      createHash('sha256').update(bytes).digest('hex'),
    );
    const replay = await cancelInvoice(sourceId, 'front-a-ticket-cancel').expect(200);
    expect(replay.body.cancellationNoteId).toBe(noteId);
    await cancelInvoice(sourceId, 'front-a-ticket-other').expect(409);
    await post(
      'credit-notes',
      apiKey.secret,
      'front-a-ticket-partial',
      credit(sourceId, 'PARTIAL', '1'),
    ).expect(422);
    await post('debit-notes', apiKey.secret, 'front-a-ticket-debit', debit(sourceId, '100')).expect(
      404,
    );
    expect(
      await prisma.fiscalDocument.count({
        where: { sourceFiscalDocumentId: sourceId, type: 'CREDIT_NOTE' },
      }),
    ).toBe(1);
  });

  it('delivers only integrity-verified signed XML to its original M2M association', async () => {
    const sourceId = await acceptedInvoice('front-a-xml-source');
    const created = await post(
      'debit-notes',
      apiKey.secret,
      'front-a-xml-debit',
      debit(sourceId, '100'),
    ).expect(201);
    const url = `${base()}/corrective-notes/${created.body.documentId}/signed-xml`;
    const response = await request(app.getHttpServer())
      .get(url)
      .set('X-API-Key', apiKey.secret)
      .expect(200);
    const bytes = Buffer.isBuffer(response.body)
      ? response.body
      : Buffer.from(response.text, 'utf8');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-content-sha256']).toBe(
      createHash('sha256').update(bytes).digest('hex'),
    );
    expect(bytes.toString('utf8')).toContain('<NotaDebitoElectronica');
    expect((await app.get<XmlSignerPort>(XML_SIGNER).verify(bytes.toString('utf8'))).isValid).toBe(
      true,
    );
    await request(app.getHttpServer())
      .get(`${base()}/corrective-notes/${sourceId}/signed-xml`)
      .set('X-API-Key', apiKey.secret)
      .expect(404);

    const other = await lab.registerAssociation({
      tenantId,
      companyId,
      provider: 'AUDIT_TEST',
      externalConsumerKey: 'front-a-xml-other',
      externalCompanyKey: 'same-issuer',
      environment: 'SANDBOX',
      actorId: adminUserId,
      correlationId: randomUUID(),
    });
    const otherKey = await lab.issueKey({
      tenantId,
      associationId: other.associationId,
      scopes: ['fiscal-v2:operations:read'],
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
      actorId: adminUserId,
      correlationId: randomUUID(),
    });
    await request(app.getHttpServer()).get(url).set('X-API-Key', otherKey.secret).expect(404);

    const artifact = await prisma.fiscalXmlArtifact.findFirstOrThrow({
      where: { fiscalDocumentId: created.body.documentId },
    });
    await prisma.fiscalXmlArtifact.update({
      where: { id: artifact.id },
      data: { signedXmlSha256: '0'.repeat(64) },
    });
    await request(app.getHttpServer())
      .get(url)
      .set('X-API-Key', apiKey.secret)
      .expect(422)
      .expect(({ body }) => expect(body.error.code).toBe('ARTIFACT_INTEGRITY_FAILURE'));
    await prisma.fiscalXmlArtifact.update({
      where: { id: artifact.id },
      data: { signedXmlSha256: artifact.signedXmlSha256 },
    });
  });

  it('rejects a persisted original whose fiscal reference no longer matches its identity', async () => {
    const sourceId = await acceptedInvoice('front-a-invalid-reference-source');
    const original = await prisma.fiscalDocument.findUniqueOrThrow({ where: { id: sourceId } });
    await prisma.fiscalDocument.update({
      where: { id: sourceId },
      data: { clave: '0'.repeat(50) },
    });
    await post(
      'credit-notes',
      apiKey.secret,
      'front-a-invalid-reference',
      credit(sourceId, 'TOTAL'),
    )
      .expect(422)
      .expect(({ body }) => expect(body.error.code).toBe('CORRECTION_SOURCE_REFERENCE_INVALID'));
    expect(await prisma.fiscalDocument.count({ where: { sourceFiscalDocumentId: sourceId } })).toBe(
      0,
    );
    await prisma.fiscalDocument.update({
      where: { id: sourceId },
      data: { clave: original.clave },
    });
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
    requireCreated(
      await post(
        'credit-notes',
        apiKey.secret,
        'w3a-exempt-credit',
        credit(exemptId, 'PARTIAL', '1'),
      ),
    );
    const exemptDebitSource = await acceptedInvoice('w3b-exempt-debit-source', 'EXEMPT');
    const exemptDebit = requireCreated(
      await post('debit-notes', apiKey.secret, 'w3a-exempt-debit', debit(exemptDebitSource, '100')),
    );
    expect(
      (
        await prisma.fiscalDocument.findUniqueOrThrow({
          where: { id: exemptDebit.body.documentId },
        })
      ).type,
    ).toBe('DEBIT_NOTE');
    const taxableId = await acceptedInvoice('w3a-debit-source');
    requireCreated(
      await post('debit-notes', apiKey.secret, 'w3a-taxed-debit', debit(taxableId, '100')),
    );
    const exemptTotalId = await acceptedInvoice('w3a-exempt-total-source', 'EXEMPT');
    requireCreated(
      await post('credit-notes', apiKey.secret, 'w3a-exempt-total', credit(exemptTotalId, 'TOTAL')),
    );
  });

  it('corrects a synthetic mixed invoice while preserving each tax treatment', async () => {
    const sourceId = await acceptedInvoice('w3a-mixed-source', 'TAX', true);
    const created = requireCreated(
      await post('credit-notes', apiKey.secret, 'w3a-mixed-total', credit(sourceId, 'TOTAL')),
    );
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
      actorId: adminUserId,
      correlationId: randomUUID(),
    });
    const otherKey = await lab.issueKey({
      tenantId,
      associationId: other.associationId,
      scopes: [...scopes],
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
      actorId: adminUserId,
      correlationId: randomUUID(),
    });
    await post('credit-notes', otherKey.secret, 'w3a-cross', credit(sourceId, 'TOTAL')).expect(404);
    const readOnly = await lab.issueKey({
      tenantId,
      associationId: other.associationId,
      scopes: ['fiscal-v2:operations:read'],
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
      rotationEndsAt: new Date(Date.now() + 60_000),
      actorId: adminUserId,
      correlationId: randomUUID(),
    });
    await post('credit-notes', readOnly.secret, 'w3a-scope', credit(sourceId, 'TOTAL')).expect(403);
    await lab.revokeKey({
      tenantId,
      associationId: other.associationId,
      apiKeyId: otherKey.apiKeyId,
      actorId: adminUserId,
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
      actorId: adminUserId,
      correlationId: randomUUID(),
    });
    await post('credit-notes', rotated.secret, 'w3a-rotation', credit(sourceId, 'TOTAL')).expect(
      201,
    );
    apiKey = rotated;
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

  it('serializes concurrent ND adjustments and persists an auditable debit ledger', async () => {
    const sourceId = await acceptedInvoice('integration-debit-ledger-source');
    await post(
      'debit-notes',
      apiKey.secret,
      'integration-debit-inexact',
      debit(sourceId, '100.00001'),
    ).expect(422);
    const [first, second] = await Promise.all([
      post('debit-notes', apiKey.secret, 'integration-debit-a', debit(sourceId, '100')),
      post('debit-notes', apiKey.secret, 'integration-debit-b', debit(sourceId, '100')),
    ]);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.documentId).not.toBe(second.body.documentId);
    const documents = await prisma.fiscalDocument.findMany({
      where: { sourceFiscalDocumentId: sourceId, type: 'DEBIT_NOTE' },
      include: { xmlArtifacts: true },
    });
    expect(documents).toHaveLength(2);
    const after = documents.map((document) => {
      const reference = document.referenceSnapshot as Record<string, unknown>;
      expect(reference).toMatchObject({
        clave: expect.stringMatching(/^\d{50}$/),
        code: '02',
        debitLedgerBefore: expect.any(Array),
        debitLedgerAfter: expect.any(Array),
      });
      expect(document.xmlArtifacts[0].xsdValidationStatus).toBe('VALID');
      return (reference.debitLedgerAfter as Array<{ adjustedBaseAmount: string }>)[0]
        .adjustedBaseAmount;
    });
    expect(after.sort()).toEqual(['100.00000', '200.00000']);
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

  it('cancels only by total NC after fiscal acceptance and confirms an edited replacement', async () => {
    const originalId = await acceptedInvoice('cancel-replace-source');
    const first = await cancelInvoice(originalId, 'cancel-replace').expect(200);
    expect(first.body.state).toBe('CREDIT_NOTE_PENDING');
    const workflowId = first.body.workflowId as string;
    const noteId = first.body.cancellationNoteId as string;
    const note = await prisma.fiscalDocument.findUniqueOrThrow({
      where: { id: noteId },
      include: { xmlArtifacts: true },
    });
    expect(note).toMatchObject({ type: 'CREDIT_NOTE', sourceFiscalDocumentId: originalId });
    expect(note.xmlArtifacts[0].xsdValidationStatus).toBe('VALID');
    expect(
      (
        await app
          .get<XmlSignerPort>(XML_SIGNER)
          .verify(
            (
              await app
                .get<StoragePort>(STORAGE_PORT)
                .download(note.xmlArtifacts[0].signedXmlStorageKey ?? '')
            ).toString('utf8'),
          )
      ).isValid,
    ).toBe(true);
    await workflowPost(workflowId, 'replacement-draft', 'draft-too-soon').expect(422);
    expect(
      await prisma.fiscalDocument.count({
        where: { type: 'INVOICE', sourceFiscalDocumentId: originalId },
      }),
    ).toBe(0);
    await prisma.fiscalDocument.update({ where: { id: noteId }, data: { status: 'ACCEPTED' } });
    await workflowGet(workflowId)
      .expect(200)
      .expect(({ body }) => expect(body.state).toBe('CANCELLED'));
    const drafted = await workflowPost(workflowId, 'replacement-draft', 'draft-replace', {
      observation: 'Sustituye factura original',
    }).expect(200);
    expect(drafted.body.state).toBe('REPLACEMENT_DRAFT');
    expect(drafted.body.draft.receiver.name).toBe('Receptor sintético');
    expect(drafted.body.draft.lines[0].description).toBe('Servicio sintético');
    const edited = {
      ...drafted.body.draft,
      receiver: { ...drafted.body.draft.receiver, name: 'Receptor corregido' },
      lines: [{ ...drafted.body.draft.lines[0], description: 'Servicio corregido' }],
    };
    const confirmed = await workflowPost(
      workflowId,
      'replacement-confirmation',
      'confirm-replace',
      {
        intent: edited,
      },
    ).expect(200);
    expect(confirmed.body.state).toBe('REPLACEMENT_ISSUED');
    const replacement = await prisma.fiscalDocument.findUniqueOrThrow({
      where: { id: confirmed.body.replacementDocumentId },
      include: { xmlArtifacts: true },
    });
    const original = await prisma.fiscalDocument.findUniqueOrThrow({ where: { id: originalId } });
    expect(replacement).toMatchObject({ type: 'INVOICE', status: 'READY_TO_SUBMIT' });
    expect(replacement.clave).not.toBe(original.clave);
    expect(replacement.consecutive).not.toBe(original.consecutive);
    expect(replacement.xmlArtifacts[0].xsdValidationStatus).toBe('VALID');
    expect((replacement.receiverSnapshot as Record<string, unknown>).name).toBe(
      'Receptor corregido',
    );
    await workflowPost(workflowId, 'replacement-confirmation', 'confirm-replace', {
      intent: edited,
    })
      .expect(200)
      .expect(({ body }) => expect(body.replacementDocumentId).toBe(replacement.id));
    await workflowPost(workflowId, 'replacement-confirmation', 'different-key', {
      intent: edited,
    }).expect(409);
    const history = await workflowGet(workflowId, '/history').expect(200);
    expect(history.body.documents.map((d: { id: string }) => d.id)).toEqual(
      expect.arrayContaining([originalId, noteId, replacement.id]),
    );
    expect(history.body.events.map((e: { action: string }) => e.action)).toEqual(
      expect.arrayContaining([
        'cancellation.requested',
        'cancellation.cancelled',
        'cancellation.replacement_issued',
      ]),
    );
  });

  it('preserves a fixed discount through FE total NC and signed replacement', async () => {
    const originalId = await acceptedDiscountedInvoice('front-a-discount-replacement');
    const cancelled = await cancelInvoice(originalId, 'front-a-discount-cancel').expect(200);
    const workflowId = cancelled.body.workflowId as string;
    const noteId = cancelled.body.cancellationNoteId as string;
    const note = await prisma.fiscalDocument.findUniqueOrThrow({ where: { id: noteId } });
    expect(note.totals).toMatchObject({
      discountAmount: '100.00000',
      totalAmount: '1517.00000',
    });
    await prisma.fiscalDocument.update({ where: { id: noteId }, data: { status: 'ACCEPTED' } });
    await workflowGet(workflowId).expect(200);
    const drafted = await workflowPost(
      workflowId,
      'replacement-draft',
      'front-a-discount-draft',
    ).expect(200);
    expect(drafted.body.draft.lines[0].discounts).toMatchObject([
      { amount: '100', reasonCode: '07' },
    ]);
    const confirmed = await workflowPost(
      workflowId,
      'replacement-confirmation',
      'front-a-discount-confirm',
      { intent: drafted.body.draft },
    ).expect(200);
    expect(confirmed.body.state).toBe('REPLACEMENT_ISSUED');
    const replacement = await prisma.fiscalDocument.findUniqueOrThrow({
      where: { id: confirmed.body.replacementDocumentId },
      include: { xmlArtifacts: true },
    });
    expect(replacement.totals).toMatchObject({
      discountAmount: '100.00000',
      totalAmount: '1517.00000',
    });
    expect(replacement.xmlArtifacts[0].xsdValidationStatus).toBe('VALID');
    const xml = (
      await app
        .get<StoragePort>(STORAGE_PORT)
        .download(replacement.xmlArtifacts[0].signedXmlStorageKey ?? '')
    ).toString('utf8');
    expect(xml).toContain('<TotalDescuentos>100.00000</TotalDescuentos>');
    expect((await app.get<XmlSignerPort>(XML_SIGNER).verify(xml)).isValid).toBe(true);
    const replay = await workflowPost(
      workflowId,
      'replacement-confirmation',
      'front-a-discount-confirm',
      {
        intent: drafted.body.draft,
      },
    ).expect(200);
    expect(replay.body.replacementDocumentId).toBe(replacement.id);
  });

  it('prepares reversal against the accepted NC without a replacement and blocks ND policy', async () => {
    const originalId = await acceptedInvoice('reverse-no-replacement-source');
    const created = await cancelInvoice(originalId, 'reverse-no-replacement').expect(200);
    const workflowId = created.body.workflowId as string;
    await prisma.fiscalDocument.update({
      where: { id: created.body.cancellationNoteId },
      data: { status: 'ACCEPTED' },
    });
    await workflowGet(workflowId).expect(200);
    const reversed = await workflowPost(
      workflowId,
      'reversal',
      'reverse-no-replacement',
      {},
    ).expect(200);
    expect(reversed.body).toMatchObject({ state: 'BLOCKED_FISCAL_POLICY', reversalNoteId: null });
    const workflow = await prisma.fiscalCancellationWorkflow.findUniqueOrThrow({
      where: { id: workflowId },
    });
    expect(workflow.reversalPlan).toMatchObject({
      operation: 'REVERSE_CANCELLATION',
      sourceCreditNoteId: created.body.cancellationNoteId,
      reference: { documentTypeCode: '03', candidateReasonCode: '01' },
      issuanceAllowed: false,
      fiscalPolicy: 'DF_06_REFERENCE_AND_TAX_TREATMENT_PENDING',
    });
    const acceptedNote = await prisma.fiscalDocument.findUniqueOrThrow({
      where: { id: created.body.cancellationNoteId },
    });
    const issuer = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    const consecutive = buildConsecutive({
      branchCode: acceptedNote.branchCode,
      terminalCode: acceptedNote.terminalCode,
      documentType: 'DEBIT_NOTE',
      sequenceValue: acceptedNote.sequenceValue,
    });
    const previewSnapshot = {
      ...acceptedNote,
      id: randomUUID(),
      type: 'DEBIT_NOTE',
      status: 'READY_FOR_XML',
      consecutive,
      clave: buildFiscalKey({
        issuedAt: acceptedNote.issueDate,
        issuerIdentificationNumber: issuer.identificationNumber,
        consecutive,
        securityCode: acceptedNote.securityCode,
        situation: acceptedNote.situation,
      }),
      referenceSnapshot: {
        documentTypeCode: '03',
        clave: acceptedNote.clave,
        issueDate: acceptedNote.issueDate.toISOString(),
        code: '01',
        reason: 'Reversión sintética de anulación',
      },
    } as unknown as FiscalXmlDocumentSnapshot;
    const serializer = app.get(HaciendaV44XmlSerializerAdapter);
    expect(() => serializer.serialize(previewSnapshot)).toThrow(
      'FISCAL_XML_CORRECTION_REFERENCE_INVALID',
    );
    const preview = serializer.serializeLabReversalPreview(previewSnapshot);
    expect(preview.xml).toContain('<TipoDocIR>03</TipoDocIR>');
    expect(preview.xml).toContain(`<Numero>${acceptedNote.clave}</Numero>`);
    const signedPreview = await app.get<XmlSignerPort>(XML_SIGNER).sign(preview.xml, {
      data: Buffer.from(signing.pkcs12Base64, 'base64'),
      passphrase: signing.certificate.passphrase,
    });
    expect(
      app.get<XsdValidatorPort>(XSD_VALIDATOR).validate({
        ...preview,
        xml: signedPreview,
      }),
    ).toMatchObject({ isValid: true, errors: [] });
    expect((await app.get<XmlSignerPort>(XML_SIGNER).verify(signedPreview)).isValid).toBe(true);
    expect(
      await prisma.fiscalDocument.count({
        where: { type: 'DEBIT_NOTE', sourceFiscalDocumentId: originalId },
      }),
    ).toBe(0);
    await workflowPost(workflowId, 'reversal', 'reverse-no-replacement', {}).expect(200);
    await workflowPost(workflowId, 'reversal', 'reverse-other-key', {}).expect(409);
  });

  it('cancels an accepted replacement first and blocks direct-NC reversal until fiscal policy', async () => {
    const originalId = await acceptedInvoice('reverse-with-replacement-source');
    const created = await cancelInvoice(originalId, 'reverse-with-replacement').expect(200);
    const workflowId = created.body.workflowId as string;
    await prisma.fiscalDocument.update({
      where: { id: created.body.cancellationNoteId },
      data: { status: 'ACCEPTED' },
    });
    const drafted = await workflowPost(
      workflowId,
      'replacement-draft',
      'draft-with-replacement',
      {},
    ).expect(200);
    const confirmed = await workflowPost(
      workflowId,
      'replacement-confirmation',
      'confirm-with-replacement',
      {
        intent: drafted.body.draft,
      },
    ).expect(200);
    await workflowPost(workflowId, 'reversal', 'reverse-before-accept', {}).expect(422);
    await prisma.fiscalDocument.update({
      where: { id: confirmed.body.replacementDocumentId },
      data: { status: 'ACCEPTED' },
    });
    const requested = await workflowPost(
      workflowId,
      'reversal',
      'reverse-with-replacement',
      {},
    ).expect(200);
    expect(requested.body.state).toBe('REPLACEMENT_CANCELLATION_PENDING');
    const replacementNc = await prisma.fiscalDocument.findUniqueOrThrow({
      where: { id: requested.body.replacementCancellationNoteId },
      include: { xmlArtifacts: true },
    });
    expect(replacementNc).toMatchObject({
      type: 'CREDIT_NOTE',
      sourceFiscalDocumentId: confirmed.body.replacementDocumentId,
    });
    expect(replacementNc.xmlArtifacts[0].xsdValidationStatus).toBe('VALID');
    expect((await workflowGet(workflowId, '/reversal').expect(200)).body.state).toBe(
      'REPLACEMENT_CANCELLATION_PENDING',
    );
    await prisma.fiscalDocument.update({
      where: { id: replacementNc.id },
      data: { status: 'ACCEPTED' },
    });
    const blocked = await workflowGet(workflowId, '/reversal').expect(200);
    expect(blocked.body).toMatchObject({ state: 'BLOCKED_FISCAL_POLICY', reversalNoteId: null });
    const row = await prisma.fiscalCancellationWorkflow.findUniqueOrThrow({
      where: { id: workflowId },
    });
    expect(row.reversalPlan).toMatchObject({ sourceCreditNoteId: created.body.cancellationNoteId });
    expect(
      await prisma.fiscalDocument.count({
        where: { type: 'DEBIT_NOTE', sourceFiscalDocumentId: originalId },
      }),
    ).toBe(0);
  });

  it('refuses an altered NC reference or tax amount before claiming reversal', async () => {
    const originalId = await acceptedInvoice('reverse-tampered-credit-source');
    const created = await cancelInvoice(originalId, 'reverse-tampered-credit').expect(200);
    const note = await prisma.fiscalDocument.findUniqueOrThrow({
      where: { id: created.body.cancellationNoteId },
    });
    await prisma.fiscalDocument.update({
      where: { id: note.id },
      data: {
        status: 'ACCEPTED',
        referenceSnapshot: { ...(note.referenceSnapshot as object), code: '02' },
      },
    });
    await workflowGet(created.body.workflowId).expect(200);
    await workflowPost(created.body.workflowId, 'reversal', 'reverse-tampered-attempt').expect(422);
    expect(
      (
        await prisma.fiscalCancellationWorkflow.findUniqueOrThrow({
          where: { id: created.body.workflowId },
        })
      ).reversalKey,
    ).toBeNull();
    const lines = note.lines as Array<Record<string, unknown>>;
    await prisma.fiscalDocument.update({
      where: { id: note.id },
      data: {
        referenceSnapshot: note.referenceSnapshot as object,
        lines: [{ ...lines[0], taxAmount: '999.00000' }],
      },
    });
    await workflowPost(created.body.workflowId, 'reversal', 'reverse-tampered-attempt').expect(422);
    await prisma.fiscalDocument.update({
      where: { id: note.id },
      data: { lines: note.lines as object[] },
    });
    const blocked = await workflowPost(
      created.body.workflowId,
      'reversal',
      'reverse-tampered-attempt',
    ).expect(200);
    expect(blocked.body.state).toBe('BLOCKED_FISCAL_POLICY');
    expect(blocked.body.reversalPreparation.snapshotSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(
      await prisma.fiscalDocument.count({
        where: { sourceFiscalDocumentId: note.id, type: 'DEBIT_NOTE' },
      }),
    ).toBe(0);
  });

  it('keeps recoverable state when the original or replacement NC is rejected', async () => {
    const rejectedSource = await acceptedInvoice('cancel-note-rejected-source');
    const first = await cancelInvoice(rejectedSource, 'cancel-note-rejected').expect(200);
    await prisma.fiscalDocument.update({
      where: { id: first.body.cancellationNoteId },
      data: { status: 'REJECTED' },
    });
    await workflowGet(first.body.workflowId)
      .expect(200)
      .expect(({ body }) => expect(body.state).toBe('RECOVERY_REQUIRED'));
    await workflowPost(first.body.workflowId, 'replacement-draft', 'draft-rejected').expect(422);

    const source = await acceptedInvoice('replacement-nc-rejected-source');
    const cancel = await cancelInvoice(source, 'replacement-nc-rejected').expect(200);
    await prisma.fiscalDocument.update({
      where: { id: cancel.body.cancellationNoteId },
      data: { status: 'ACCEPTED' },
    });
    const draft = await workflowPost(
      cancel.body.workflowId,
      'replacement-draft',
      'draft-rejected-nc',
      {},
    ).expect(200);
    const replacement = await workflowPost(
      cancel.body.workflowId,
      'replacement-confirmation',
      'confirm-rejected-nc',
      {
        intent: draft.body.draft,
      },
    ).expect(200);
    await prisma.fiscalDocument.update({
      where: { id: replacement.body.replacementDocumentId },
      data: { status: 'ACCEPTED' },
    });
    const reverse = await workflowPost(
      cancel.body.workflowId,
      'reversal',
      'reverse-rejected-nc',
      {},
    ).expect(200);
    await prisma.fiscalDocument.update({
      where: { id: reverse.body.replacementCancellationNoteId },
      data: { status: 'REJECTED' },
    });
    await workflowGet(cancel.body.workflowId)
      .expect(200)
      .expect(({ body }) => expect(body.state).toBe('RECOVERY_REQUIRED'));
    expect(
      await prisma.fiscalDocument.count({
        where: { type: 'DEBIT_NOTE', sourceFiscalDocumentId: source },
      }),
    ).toBe(0);
  });

  it('blocks ND after a rejected replacement without making a second cancellation NC', async () => {
    const source = await acceptedInvoice('replacement-rejected-source');
    const cancel = await cancelInvoice(source, 'replacement-rejected-cancel').expect(200);
    await prisma.fiscalDocument.update({
      where: { id: cancel.body.cancellationNoteId },
      data: { status: 'ACCEPTED' },
    });
    const draft = await workflowPost(
      cancel.body.workflowId,
      'replacement-draft',
      'replacement-rejected-draft',
    ).expect(200);
    const replacement = await workflowPost(
      cancel.body.workflowId,
      'replacement-confirmation',
      'replacement-rejected-confirm',
      {
        intent: draft.body.draft,
      },
    ).expect(200);
    await prisma.fiscalDocument.update({
      where: { id: replacement.body.replacementDocumentId },
      data: { status: 'REJECTED' },
    });
    await workflowGet(cancel.body.workflowId)
      .expect(200)
      .expect(({ body }) => expect(body.state).toBe('RECOVERY_REQUIRED'));
    const reversal = await workflowPost(
      cancel.body.workflowId,
      'reversal',
      'replacement-rejected-reverse',
    ).expect(200);
    expect(reversal.body).toMatchObject({
      state: 'BLOCKED_FISCAL_POLICY',
      replacementCancellationNoteId: null,
      reversalNoteId: null,
    });
    expect(
      await prisma.fiscalDocument.count({
        where: { sourceFiscalDocumentId: replacement.body.replacementDocumentId },
      }),
    ).toBe(0);
  });

  it('recovers an interrupted cancellation using one NC and one workflow', async () => {
    const source = await acceptedInvoice('cancel-recovery-source');
    engine.interruptOnceAfterReservation();
    await cancelInvoice(source, 'cancel-recovery').expect(503);
    const pending = await prisma.fiscalCancellationWorkflow.findUniqueOrThrow({
      where: { originalDocumentId: source },
    });
    expect(pending.state).toBe('RECOVERY_REQUIRED');
    const replay = await cancelInvoice(source, 'cancel-recovery').expect(200);
    expect(replay.body).toMatchObject({ workflowId: pending.id, state: 'CREDIT_NOTE_PENDING' });
    expect(
      await prisma.fiscalCancellationWorkflow.count({ where: { originalDocumentId: source } }),
    ).toBe(1);
    expect(
      await prisma.fiscalDocument.count({
        where: { type: 'CREDIT_NOTE', sourceFiscalDocumentId: source },
      }),
    ).toBe(1);
    await cancelInvoice(source, 'cancel-recovery')
      .expect(200)
      .expect(({ body }) => expect(body.cancellationNoteId).toBe(replay.body.cancellationNoteId));
    await cancelInvoice(source, 'cancel-different-key').expect(409);
  });

  it('recovers replacement emission after an interruption without a second FE', async () => {
    const source = await acceptedInvoice('replacement-recovery-source');
    const cancel = await cancelInvoice(source, 'replacement-recovery-cancel').expect(200);
    await prisma.fiscalDocument.update({
      where: { id: cancel.body.cancellationNoteId },
      data: { status: 'ACCEPTED' },
    });
    const draft = await workflowPost(
      cancel.body.workflowId,
      'replacement-draft',
      'replacement-recovery-draft',
    ).expect(200);
    engine.interruptOnceAfterDocument();
    await workflowPost(
      cancel.body.workflowId,
      'replacement-confirmation',
      'replacement-recovery-confirm',
      { intent: draft.body.draft },
    ).expect(503);
    const interrupted = await prisma.fiscalCancellationWorkflow.findUniqueOrThrow({
      where: { id: cancel.body.workflowId },
    });
    expect(interrupted.state).toBe('RECOVERY_REQUIRED');
    const replay = await workflowPost(
      cancel.body.workflowId,
      'replacement-confirmation',
      'replacement-recovery-confirm',
      { intent: draft.body.draft },
    ).expect(200);
    expect(replay.body.state).toBe('REPLACEMENT_ISSUED');
    const reservation = await prisma.fiscalIdempotencyKeyV2.findFirstOrThrow({
      where: { associationId, key: `replacement:${cancel.body.workflowId}` },
    });
    expect(reservation.fiscalDocumentId).toBe(replay.body.replacementDocumentId);
    await workflowPost(
      cancel.body.workflowId,
      'replacement-confirmation',
      'replacement-recovery-confirm',
      { intent: draft.body.draft },
    )
      .expect(200)
      .expect(({ body }) => expect(body.replacementDocumentId).toBe(reservation.fiscalDocumentId));
    const resumed = await prisma.fiscalDocument.findUniqueOrThrow({
      where: { id: replay.body.replacementDocumentId },
      include: { xmlArtifacts: true },
    });
    expect(resumed.xmlArtifacts[0].xsdValidationStatus).toBe('VALID');
  });

  it('serializes concurrent cancellation requests with different keys', async () => {
    const source = await acceptedInvoice('cancel-concurrent-source');
    const [a, b] = await Promise.all([
      cancelInvoice(source, 'cancel-concurrent-a'),
      cancelInvoice(source, 'cancel-concurrent-b'),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(
      await prisma.fiscalCancellationWorkflow.count({ where: { originalDocumentId: source } }),
    ).toBe(1);
    expect(
      await prisma.fiscalDocument.count({
        where: { type: 'CREDIT_NOTE', sourceFiscalDocumentId: source },
      }),
    ).toBe(1);
  });

  it('isolates workflow history and rejects revoked or insufficient M2M credentials', async () => {
    const source = await acceptedInvoice('cancel-security-source');
    const cancel = await cancelInvoice(source, 'cancel-security').expect(200);
    const other = await createFiscalTenantFixture(context);
    const foreign = await lab.registerAssociation({
      tenantId: other.tenantId,
      companyId: other.companyId,
      provider: 'AUDIT_TEST',
      externalConsumerKey: 'cancel-foreign-app',
      externalCompanyKey: 'cancel-foreign-company',
      environment: 'SANDBOX',
      actorId: other.userId,
      correlationId: randomUUID(),
    });
    const foreignKey = await lab.issueKey({
      tenantId: other.tenantId,
      associationId: foreign.associationId,
      scopes: [...scopes],
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
      actorId: other.userId,
      correlationId: randomUUID(),
    });
    await request(app.getHttpServer())
      .get(
        `/api/v2/lab/companies/${other.companyId}/fiscal-documents/SANDBOX/cancellations/${cancel.body.workflowId}/history`,
      )
      .set('X-API-Key', foreignKey.secret)
      .expect(404);
    const limited = await lab.issueKey({
      tenantId,
      associationId,
      scopes: ['fiscal-v2:operations:read'],
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
      rotationEndsAt: new Date(Date.now() + 60_000),
      actorId: adminUserId,
      correlationId: randomUUID(),
    });
    await cancelInvoice(source, 'cancel-security-limited', limited.secret).expect(403);
    await workflowGet(cancel.body.workflowId, '/history', limited.secret).expect(200);
    await lab.revokeKey({
      tenantId,
      associationId,
      apiKeyId: limited.apiKeyId,
      actorId: adminUserId,
      correlationId: randomUUID(),
    });
    await workflowGet(cancel.body.workflowId, '/history', limited.secret).expect(401);
  });
});
