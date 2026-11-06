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
  XML_SIGNER,
  XmlSignerPort,
} from '../../../src/infrastructure/signing/ports/xml-signer.port';
import { ConsumerV2LabService } from '../../../src/modules/fiscal-consumers/application/consumer-v2-lab.service';
import { createTestSigningMaterial } from '../../../src/modules/fiscal-documents/domain/fiscal-xml/__tests__/fiscal-xml-test-fixtures';
import { W2B2FiscalLabModule } from '../../../src/modules/fiscal-intent-v2/w2-b2-fiscal-lab.module';
import { W2B2LabInvoiceService } from '../../../src/modules/fiscal-intent-v2/w2-b2-lab-invoice.service';
import {
  projectW2BInvoiceLab,
  projectW2BTicketLab,
  W2B_LAB_HASH_VERSION,
} from '../../../src/modules/fiscal-intent-v2/w2-b-lab-projection';
import { createGuardedTestPrisma } from '../../helpers/guarded-test-prisma';
import { installGuardedTestDatabaseEnvironment } from '../../helpers/test-database-safety';
import {
  authorizeApiKeyForCompany,
  configureDefaultFiscalSetup,
  configureValidCompanyFiscalProfile,
  createEnabledHaciendaConnection,
  createFiscalApiKey,
  createFiscalTenantFixture,
  fiscalInvoicePayload,
  resetFiscalE2eData,
  type FiscalE2eContext,
} from '../../helpers/fiscal-e2e-helpers';

const signing = createTestSigningMaterial();
const scopes = [
  'fiscal-v2:invoices:create',
  'fiscal-v2:tickets:create',
  'fiscal-v2:operations:read',
  'fiscal-v2:invoices:submit',
] as const;

function invoiceIntent(externalOperationId: string, description = 'Servicio sintético') {
  return {
    externalOperationId,
    policyVersion: 'LAB_SYNTHETIC_V44_ONLY',
    receiver: {
      identificationType: 'JURIDICA',
      identificationNumber: '3101000001',
      name: 'Receptor sintético',
      email: 'receiver@example.com',
    },
    currency: 'CRC',
    saleCondition: '01',
    paymentMethods: [{ code: '01', amount: '1130' }],
    lines: [
      {
        lineNumber: 1,
        source: { allocationId: externalOperationId },
        description,
        cabysCode: '8313100000100',
        unitCode: 'Sp',
        quantity: '1',
        unitPrice: '1000',
        priceInputMode: 'EXCLUSIVE',
        discounts: [],
        taxTreatment: 'LAB_TAXABLE_IVA_13_XML',
        taxes: [{ code: '01', rateCode: '08', rate: '13', base: '1000', amount: '130' }],
      },
    ],
  };
}

function ticketIntent(externalOperationId: string) {
  const { receiver: _receiver, ...intent } = invoiceIntent(externalOperationId);
  return intent;
}

describe('W2-B2 persistent fiscal creation in disposable PostgreSQL', () => {
  jest.setTimeout(120000);
  let context: FiscalE2eContext;
  let app: INestApplication;
  let prisma: PrismaClient;
  let lab: ConsumerV2LabService;
  let invoices: W2B2LabInvoiceService;
  let tenantId: string;
  let adminUserId: string;
  let companyId: string;
  let consumerId: string;
  let associationId: string;
  let key: { apiKeyId: string; secret: string };
  const endpoint = () => `/api/v2/lab/companies/${companyId}/fiscal-documents/SANDBOX/invoices`;
  const post = (secret: string, keyValue: string, body: object) =>
    request(app.getHttpServer())
      .post(endpoint())
      .set('X-API-Key', secret)
      .set('Idempotency-Key', keyValue)
      .send(body);
  const ticketEndpoint = () =>
    `/api/v2/lab/companies/${companyId}/fiscal-documents/SANDBOX/tickets`;
  const postTicket = (secret: string, keyValue: string, body: ReturnType<typeof ticketIntent>) =>
    request(app.getHttpServer())
      .post(ticketEndpoint())
      .set('X-API-Key', secret)
      .set('Idempotency-Key', keyValue)
      .send(body);
  const lookupTicket = (
    secret: string,
    keyValue: string,
    body: ReturnType<typeof ticketIntent>,
  ) => {
    const projection = projectW2BTicketLab(body, {
      tenantId,
      consumerId,
      associationId,
      companyId,
      environment: 'SANDBOX',
    });
    return request(app.getHttpServer())
      .post(`/api/v2/companies/${companyId}/fiscal-documents/SANDBOX/operations/lookup`)
      .set('X-API-Key', secret)
      .send({
        operation: 'CREATE_TICKET',
        idempotencyKey: keyValue,
        requestHashVersion: projection.hashVersion,
        requestHash: projection.requestHash,
      });
  };
  const lookup = (
    secret: string,
    keyValue: string,
    body: ReturnType<typeof invoiceIntent>,
    hash?: string,
  ) => {
    const projection = projectW2BInvoiceLab(body, {
      tenantId,
      consumerId,
      associationId,
      companyId,
      environment: 'SANDBOX',
    });
    return request(app.getHttpServer())
      .post(`/api/v2/companies/${companyId}/fiscal-documents/SANDBOX/operations/lookup`)
      .set('X-API-Key', secret)
      .send({
        operation: 'CREATE_INVOICE',
        idempotencyKey: keyValue,
        requestHashVersion: W2B_LAB_HASH_VERSION,
        requestHash: hash ?? projection.requestHash,
      });
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.FISCAL_WORKER_ENABLE_IN_TESTS = 'false';
    process.env.FISCAL_E2E_HACIENDA_SECRET ??= 'disposable-test-sentinel';
    installGuardedTestDatabaseEnvironment();
    ({ prisma } = await createGuardedTestPrisma());
    const module = await Test.createTestingModule({
      imports: [AppModule, W2B2FiscalLabModule],
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
    invoices = app.get(W2B2LabInvoiceService);
    const fixture = await createFiscalTenantFixture(context);
    tenantId = fixture.tenantId;
    adminUserId = fixture.userId;
    companyId = fixture.companyId;
    await createEnabledHaciendaConnection(prisma, tenantId, companyId);
    await configureValidCompanyFiscalProfile(context, fixture);
    await configureDefaultFiscalSetup(context, fixture, 'INVOICE');
    await configureDefaultFiscalSetup(context, fixture, 'TICKET');
    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    const secretRef = `W2B2_TEST_CERT_${companyId.replace(/-/g, '_')}`;
    const passRef = `W2B2_TEST_PASS_${companyId.replace(/-/g, '_')}`;
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
      externalConsumerKey: 'synthetic-w2b2-app',
      externalCompanyKey: 'synthetic-w2b2-issuer',
      environment: 'SANDBOX',
      actorId: fixture.userId,
      correlationId: randomUUID(),
    });
    consumerId = association.consumerId;
    associationId = association.associationId;
    key = await lab.issueKey({
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

  it('creates one durable document and signed XSD-valid XML with v2 origin', async () => {
    const intent = invoiceIntent('w2b2-create-1');
    let created = await post(key.secret, 'w2b2-create-1', intent);
    for (let attempt = 0; attempt < 3 && created.status === 202; attempt += 1)
      created = await post(key.secret, 'w2b2-create-1', intent);
    expect([200, 201]).toContain(created.status);
    expect(created.body).toMatchObject({ state: 'COMMITTED', documentStatus: 'READY_TO_SUBMIT' });
    const documentId = created.body.documentId as string;
    const doc = await prisma.fiscalDocument.findUniqueOrThrow({
      where: { id: documentId },
      include: { xmlArtifacts: true },
    });
    expect(doc).toMatchObject({
      tenantId,
      companyId,
      originConsumerId: consumerId,
      originAssociationId: associationId,
      status: 'READY_TO_SUBMIT',
    });
    expect(doc.xmlArtifacts).toHaveLength(1);
    expect(doc.xmlArtifacts[0]).toMatchObject({ xsdValidationStatus: 'VALID' });
    const storage = app.get<StoragePort>(STORAGE_PORT);
    const signed = (await storage.download(doc.xmlArtifacts[0].signedXmlStorageKey ?? '')).toString(
      'utf8',
    );
    expect(signed).toContain('<ds:Signature');
    expect((await app.get<XmlSignerPort>(XML_SIGNER).verify(signed)).isValid).toBe(true);
    const reservation = await prisma.fiscalIdempotencyKeyV2.findUniqueOrThrow({
      where: { id: created.body.operationId },
    });
    expect(reservation).toMatchObject({
      associationId,
      environment: 'SANDBOX',
      state: 'COMMITTED',
      fiscalDocumentId: documentId,
      requestHashVersion: 'w2-b-fiscal-lab.v1',
    });
    expect(
      await prisma.fiscalIdempotencyKey.count({ where: { fiscalDocumentId: documentId } }),
    ).toBe(0);
    const auditActions = (
      await prisma.auditLog.findMany({
        where: { resource: `FiscalIdempotencyKeyV2:${reservation.id}` },
        select: { action: true },
      })
    ).map((entry) => entry.action);
    expect(auditActions).toEqual(
      expect.arrayContaining([
        'fiscal-v2.operation.reserved',
        'fiscal-v2.document.created',
        'fiscal-v2.xml.processing',
        'fiscal-v2.xml.ready',
      ]),
    );
    await lookup(key.secret, 'w2b2-create-1', invoiceIntent('w2b2-create-1'))
      .expect(200)
      .expect(({ body }) =>
        expect(body).toMatchObject({ state: 'COMMITTED', fiscalDocumentId: documentId }),
      );
    await lookup(
      key.secret,
      'w2b2-create-1',
      invoiceIntent('w2b2-create-1'),
      '0'.repeat(64),
    ).expect(404);
    await request(app.getHttpServer())
      .get(`${endpoint()}/${documentId}`)
      .set('X-API-Key', key.secret)
      .expect(200)
      .expect(({ body }) =>
        expect(body).toMatchObject({ id: documentId, status: 'READY_TO_SUBMIT' }),
      );
  });

  it('emits a discounted FE with taxable and exempt lines and rejects percent syntax', async () => {
    const operation = 'front-a-fe-discount';
    const source = invoiceIntent(operation);
    const body = {
      ...source,
      paymentMethods: [{ code: '01', amount: '1517' }],
      lines: [
        {
          ...source.lines[0],
          quantity: '2',
          unitPrice: '500',
          discounts: [{ amount: '100', reasonCode: '07', reason: 'Descuento comercial' }],
          taxes: [{ code: '01', rateCode: '08', rate: '13', base: '900', amount: '117' }],
        },
        {
          ...source.lines[0],
          lineNumber: 2,
          quantity: '1',
          unitPrice: '500',
          taxTreatment: 'LAB_EXEMPT_XML',
          taxes: [{ code: '01', rateCode: '10', rate: '0', base: '500', amount: '0' }],
        },
      ],
    };
    const created = await post(key.secret, operation, body).expect(201);
    const doc = await prisma.fiscalDocument.findUniqueOrThrow({
      where: { id: created.body.documentId },
      include: { xmlArtifacts: true },
    });
    expect(doc.xmlArtifacts[0].xsdValidationStatus).toBe('VALID');
    const signed = (
      await app
        .get<StoragePort>(STORAGE_PORT)
        .download(doc.xmlArtifacts[0].signedXmlStorageKey ?? '')
    ).toString('utf8');
    expect(signed).toContain('<MontoDescuento>100.00000</MontoDescuento>');
    expect(signed).toContain('<TotalDescuentos>100.00000</TotalDescuentos>');
    expect(signed).toContain('<TotalComprobante>1517.00000</TotalComprobante>');
    expect((await app.get<XmlSignerPort>(XML_SIGNER).verify(signed)).isValid).toBe(true);
    const invalid = {
      ...body,
      externalOperationId: 'front-a-fe-percent',
      lines: [
        {
          ...body.lines[0],
          discounts: [{ amount: '10%', reasonCode: '07', reason: 'Descuento comercial' }],
        },
      ],
    };
    await post(key.secret, 'front-a-fe-percent', invalid).expect(400);
  });

  it('downloads unchanged invoice XML, verifies SHA-256 and recovers an initially unavailable artifact', async () => {
    const created = await post(
      key.secret,
      'w2b2-xml-download',
      invoiceIntent('w2b2-xml-download'),
    ).expect(201);
    const documentId = created.body.documentId as string;
    const url = `${endpoint()}/${documentId}/signed-xml`;
    const artifact = await prisma.fiscalXmlArtifact.findFirstOrThrow({
      where: { fiscalDocumentId: documentId },
    });
    const stored = await app
      .get<StoragePort>(STORAGE_PORT)
      .download(artifact.signedXmlStorageKey ?? '');
    const downloaded = await request(app.getHttpServer())
      .get(url)
      .set('X-API-Key', key.secret)
      .expect(200);
    const bytes = Buffer.isBuffer(downloaded.body)
      ? downloaded.body
      : Buffer.from(downloaded.text, 'utf8');
    expect(bytes.equals(stored)).toBe(true);
    expect(downloaded.headers['content-type']).toMatch(/^application\/xml/);
    expect(downloaded.headers['cache-control']).toBe('no-store');
    expect(downloaded.headers['x-content-sha256']).toBe(
      createHash('sha256').update(stored).digest('hex'),
    );
    expect(downloaded.headers['x-content-sha256']).toBe(artifact.signedXmlSha256);

    await prisma.fiscalXmlArtifact.update({
      where: { id: artifact.id },
      data: { signedXmlSha256: '0'.repeat(64) },
    });
    await request(app.getHttpServer())
      .get(url)
      .set('X-API-Key', key.secret)
      .expect(422)
      .expect(({ body }) => expect(body.error.code).toBe('ARTIFACT_INTEGRITY_FAILURE'));
    await prisma.fiscalXmlArtifact.update({
      where: { id: artifact.id },
      data: { signedXmlSha256: artifact.signedXmlSha256 },
    });

    await request(app.getHttpServer())
      .get(`${endpoint()}/${randomUUID()}/signed-xml`)
      .set('X-API-Key', key.secret)
      .expect(404);
    invoices.interruptOnceAfterDocument();
    await post(key.secret, 'w2b2-xml-pending', invoiceIntent('w2b2-xml-pending')).expect(503);
    const pending = await prisma.fiscalIdempotencyKeyV2.findFirstOrThrow({
      where: { associationId, key: 'w2b2-xml-pending' },
    });
    const pendingUrl = `${endpoint()}/${pending.fiscalDocumentId}/signed-xml`;
    await request(app.getHttpServer()).get(pendingUrl).set('X-API-Key', key.secret).expect(404);
    await post(key.secret, 'w2b2-xml-pending', invoiceIntent('w2b2-xml-pending')).expect(200);
    await request(app.getHttpServer()).get(pendingUrl).set('X-API-Key', key.secret).expect(200);

    const restartedModule = await Test.createTestingModule({
      imports: [AppModule, W2B2FiscalLabModule],
    }).compile();
    const restarted = restartedModule.createNestApplication();
    try {
      configureApiPrefixes(restarted);
      restarted.useGlobalFilters(new GlobalExceptionFilter('test'));
      await restarted.init();
      const afterRestart = await request(restarted.getHttpServer())
        .get(url)
        .set('X-API-Key', key.secret)
        .expect(200);
      const restartedBytes = Buffer.isBuffer(afterRestart.body)
        ? afterRestart.body
        : Buffer.from(afterRestart.text, 'utf8');
      expect(restartedBytes.equals(stored)).toBe(true);
    } finally {
      await restarted.close();
    }
  });

  it('replays exactly and rejects a changed payload without another document', async () => {
    const body = invoiceIntent('w2b2-replay');
    const first = await post(key.secret, 'w2b2-replay', body).expect(201);
    const replay = await post(key.secret, 'w2b2-replay', body).expect(200);
    expect(replay.body.documentId).toBe(first.body.documentId);
    await post(
      key.secret,
      'w2b2-replay',
      invoiceIntent('w2b2-replay', 'Cambio de contenido'),
    ).expect(409);
    expect(
      await prisma.fiscalIdempotencyKeyV2.count({ where: { associationId, key: 'w2b2-replay' } }),
    ).toBe(1);
    expect(
      await prisma.fiscalDocument.count({
        where: { originAssociationId: associationId, id: first.body.documentId },
      }),
    ).toBe(1);
  });

  it('serializes concurrent requests into one reservation and one document', async () => {
    const body = invoiceIntent('w2b2-concurrent');
    const [a, b] = await Promise.all([
      post(key.secret, 'w2b2-concurrent', body),
      post(key.secret, 'w2b2-concurrent', body),
    ]);
    expect([200, 201, 202]).toContain(a.status);
    expect([200, 201, 202]).toContain(b.status);
    const final = await post(key.secret, 'w2b2-concurrent', body).expect(200);
    expect(final.body.documentId).toBe(a.body.documentId);
    expect(final.body.documentId).toBe(b.body.documentId);
    expect(
      await prisma.fiscalIdempotencyKeyV2.count({
        where: { associationId, key: 'w2b2-concurrent' },
      }),
    ).toBe(1);
  });

  it('recovers after reservation and after document persistence without duplicate numbering', async () => {
    invoices.interruptOnceAfterReservation();
    await post(
      key.secret,
      'w2b2-interrupt-reserve',
      invoiceIntent('w2b2-interrupt-reserve'),
    ).expect(503);
    const reserved = await prisma.fiscalIdempotencyKeyV2.findFirstOrThrow({
      where: { associationId, key: 'w2b2-interrupt-reserve' },
    });
    expect(reserved).toMatchObject({ state: 'RESERVED', fiscalDocumentId: null });
    await lookup(key.secret, 'w2b2-interrupt-reserve', invoiceIntent('w2b2-interrupt-reserve'))
      .expect(202)
      .expect(({ body }) =>
        expect(body).toMatchObject({ state: 'RESERVED', fiscalDocumentId: null }),
      );
    const recovered = await post(
      key.secret,
      'w2b2-interrupt-reserve',
      invoiceIntent('w2b2-interrupt-reserve'),
    ).expect(201);
    expect(recovered.body.state).toBe('COMMITTED');
    invoices.interruptOnceAfterDocument();
    await post(
      key.secret,
      'w2b2-interrupt-document',
      invoiceIntent('w2b2-interrupt-document'),
    ).expect(503);
    const pending = await prisma.fiscalIdempotencyKeyV2.findFirstOrThrow({
      where: { associationId, key: 'w2b2-interrupt-document' },
    });
    expect(pending).toMatchObject({ state: 'RECOVERY_REQUIRED' });
    expect(pending.fiscalDocumentId).toBeTruthy();
    await lookup(key.secret, 'w2b2-interrupt-document', invoiceIntent('w2b2-interrupt-document'))
      .expect(202)
      .expect(({ body }) =>
        expect(body).toMatchObject({
          state: 'RECOVERY_REQUIRED',
          fiscalDocumentId: pending.fiscalDocumentId,
        }),
      );
    const resumed = await post(
      key.secret,
      'w2b2-interrupt-document',
      invoiceIntent('w2b2-interrupt-document'),
    ).expect(200);
    expect(resumed.body.documentId).toBe(pending.fiscalDocumentId);
    expect(
      await prisma.fiscalDocument.count({ where: { id: pending.fiscalDocumentId ?? '' } }),
    ).toBe(1);
  });

  it('recovers a failed signature using the same document', async () => {
    const signer = app.get<XmlSignerPort>(XML_SIGNER);
    const spy = jest
      .spyOn(signer, 'sign')
      .mockRejectedValueOnce(new Error('synthetic signing interruption'));
    const first = await post(
      key.secret,
      'w2b2-sign-failure',
      invoiceIntent('w2b2-sign-failure'),
    ).expect(202);
    spy.mockRestore();
    const reservation = await prisma.fiscalIdempotencyKeyV2.findUniqueOrThrow({
      where: { id: first.body.operationId },
    });
    expect(reservation).toMatchObject({
      state: 'RECOVERY_REQUIRED',
      fiscalDocumentId: first.body.documentId,
    });
    const recovered = await post(
      key.secret,
      'w2b2-sign-failure',
      invoiceIntent('w2b2-sign-failure'),
    ).expect(200);
    expect(recovered.body).toMatchObject({
      documentId: first.body.documentId,
      state: 'COMMITTED',
      documentStatus: 'READY_TO_SUBMIT',
    });
  });

  it('recovers a transient XSD engine timeout with one fiscal document', async () => {
    const body = invoiceIntent('front-a-validator-timeout');
    const validator = app.get<XsdValidatorPort>(XSD_VALIDATOR);
    const spy = jest.spyOn(validator, 'validate').mockReturnValueOnce({
      isValid: false,
      schemaVersion: 'v4.4',
      errors: [{ code: 'FISCAL_XML_VALIDATOR_TIMEOUT', message: 'XSD validation timed out.' }],
    });
    const first = await post(key.secret, 'front-a-validator-timeout', body).expect(202);
    spy.mockRestore();
    expect(first.body.state).toBe('RECOVERY_REQUIRED');
    const pending = await prisma.fiscalDocument.findUniqueOrThrow({
      where: { id: first.body.documentId },
      include: { xmlArtifacts: true },
    });
    expect(pending.xmlArtifacts[0].lastErrorCode).toBe('FISCAL_XML_VALIDATOR_UNAVAILABLE');
    const recovered = await post(key.secret, 'front-a-validator-timeout', body).expect(200);
    expect(recovered.body).toMatchObject({
      documentId: first.body.documentId,
      state: 'COMMITTED',
      documentStatus: 'READY_TO_SUBMIT',
    });
    expect(await prisma.fiscalDocument.count({ where: { id: first.body.documentId } })).toBe(1);
  });

  it('reconciles a signed document after a lost final state update', async () => {
    const body = invoiceIntent('w2b2-lost-final-update');
    const first = await post(key.secret, 'w2b2-lost-final-update', body).expect(201);
    await prisma.fiscalIdempotencyKeyV2.update({
      where: { id: first.body.operationId },
      data: { state: 'RECOVERY_REQUIRED' },
    });
    const replay = await post(key.secret, 'w2b2-lost-final-update', body).expect(200);
    expect(replay.body).toMatchObject({ documentId: first.body.documentId, state: 'COMMITTED' });
    expect(
      (
        await prisma.fiscalIdempotencyKeyV2.findUniqueOrThrow({
          where: { id: first.body.operationId },
        })
      ).state,
    ).toBe('COMMITTED');
    expect(await prisma.fiscalDocument.count({ where: { id: first.body.documentId } })).toBe(1);
  });

  it('keeps a failed signature verification terminal and prevents another document', async () => {
    const body = invoiceIntent('w2b2-terminal-signature');
    const signer = app.get<XmlSignerPort>(XML_SIGNER);
    const spy = jest.spyOn(signer, 'verify').mockResolvedValueOnce({
      isValid: false,
      validationErrors: ['synthetic-invalid-signature'],
    });
    await post(key.secret, 'w2b2-terminal-signature', body).expect(422);
    spy.mockRestore();
    const status = await lookup(key.secret, 'w2b2-terminal-signature', body).expect(200);
    expect(status.body.state).toBe('FAILED_TERMINAL');
    const documentId = status.body.fiscalDocumentId as string;
    expect(documentId).toBeTruthy();
    await post(key.secret, 'w2b2-terminal-signature', body).expect(422);
    expect(await prisma.fiscalDocument.count({ where: { id: documentId } })).toBe(1);
  });

  it('rejects unsupported fiscal treatments before reservation or numbering', async () => {
    const unsupported = invoiceIntent('w2b2-unsupported');
    unsupported.lines[0].taxes.push({
      code: '01',
      rateCode: '08',
      rate: '13',
      base: '1000',
      amount: '130',
    });
    await post(key.secret, 'w2b2-unsupported', unsupported).expect(400);
    const pendingPolicy = invoiceIntent('w2b2-pending-policy');
    pendingPolicy.lines[0].taxTreatment = 'UNAPPROVED_TREATMENT';
    await post(key.secret, 'w2b2-pending-policy', pendingPolicy).expect(422);
    expect(
      await prisma.fiscalIdempotencyKeyV2.count({
        where: {
          associationId,
          key: { in: ['w2b2-unsupported', 'w2b2-pending-policy'] },
        },
      }),
    ).toBe(0);
  });

  it('creates a real signed XSD-valid TE without receiver and with taxed and exempt lines', async () => {
    const body = ticketIntent('w2b2-ticket-signed');
    body.paymentMethods = [{ code: '02', amount: '2130' }];
    body.lines.push({
      ...body.lines[0],
      lineNumber: 2,
      source: { allocationId: 'w2b2-ticket-line-2' },
      description: 'Concepto exento sintético',
      taxTreatment: 'LAB_EXEMPT_XML',
      taxes: [{ code: '01', rateCode: '10', rate: '0', base: '1000', amount: '0' }],
    });
    const created = await postTicket(key.secret, 'w2b2-ticket-signed', body).expect(201);
    expect(created.body).toMatchObject({ state: 'COMMITTED', documentStatus: 'READY_TO_SUBMIT' });
    const documentId = created.body.documentId as string;
    const document = await prisma.fiscalDocument.findUniqueOrThrow({
      where: { id: documentId },
      include: { xmlArtifacts: true },
    });
    expect(document.type).toBe('TICKET');
    expect(document.xmlArtifacts[0].xsdValidationStatus).toBe('VALID');
    const response = await request(app.getHttpServer())
      .get(`${ticketEndpoint()}/${documentId}/signed-xml`)
      .set('X-API-Key', key.secret)
      .expect(200);
    const bytes = Buffer.isBuffer(response.body)
      ? response.body
      : Buffer.from(response.text, 'utf8');
    const xml = bytes.toString('utf8');
    expect(xml).toContain('<TiqueteElectronico');
    expect(xml).not.toContain('<Receptor>');
    expect(xml.match(/<LineaDetalle>/g)).toHaveLength(2);
    expect((await app.get<XmlSignerPort>(XML_SIGNER).verify(xml)).isValid).toBe(true);
    expect(response.headers['x-content-sha256']).toBe(
      createHash('sha256').update(bytes).digest('hex'),
    );
    await lookupTicket(key.secret, 'w2b2-ticket-signed', body)
      .expect(200)
      .expect(({ body: lookupBody }) =>
        expect(lookupBody).toMatchObject({
          state: 'COMMITTED',
          fiscalDocumentId: documentId,
        }),
      );
    await request(app.getHttpServer())
      .get(`${ticketEndpoint()}/${documentId}`)
      .set('X-API-Key', key.secret)
      .expect(200)
      .expect(({ body: status }) =>
        expect(status).toMatchObject({
          id: documentId,
          status: 'READY_TO_SUBMIT',
          errors: [],
        }),
      );
    await request(app.getHttpServer())
      .get(`${endpoint()}/${documentId}`)
      .set('X-API-Key', key.secret)
      .expect(404);
  });

  it('isolates FE and TE idempotency namespaces and serializes concurrent TE retries', async () => {
    const operation = 'w2b2-fe-te-same-key';
    const invoice = await post(key.secret, operation, invoiceIntent(operation)).expect(201);
    const ticket = ticketIntent(operation);
    ticket.paymentMethods = [{ code: '04', amount: '1130' }];
    const [a, b] = await Promise.all([
      postTicket(key.secret, operation, ticket),
      postTicket(key.secret, operation, ticket),
    ]);
    expect([200, 201, 202]).toContain(a.status);
    expect([200, 201, 202]).toContain(b.status);
    const replay = await postTicket(key.secret, operation, ticket).expect(200);
    expect(replay.body.documentId).toBe(a.body.documentId);
    expect(replay.body.documentId).toBe(b.body.documentId);
    expect(replay.body.documentId).not.toBe(invoice.body.documentId);
    expect(
      await prisma.fiscalIdempotencyKeyV2.count({
        where: { associationId, key: operation },
      }),
    ).toBe(2);
    const changed = ticketIntent(operation);
    changed.lines[0].description = 'Cambio no idempotente';
    await postTicket(key.secret, operation, changed).expect(409);
  });

  it('recovers a TE after a simulated timeout and exposes a terminal fiscal error code', async () => {
    const pendingBody = ticketIntent('w2b2-ticket-timeout');
    invoices.interruptOnceAfterDocument();
    await postTicket(key.secret, 'w2b2-ticket-timeout', pendingBody).expect(503);
    const pending = await lookupTicket(key.secret, 'w2b2-ticket-timeout', pendingBody).expect(202);
    expect(pending.body.state).toBe('RECOVERY_REQUIRED');
    const recovered = await postTicket(key.secret, 'w2b2-ticket-timeout', pendingBody).expect(200);
    expect(recovered.body).toMatchObject({
      state: 'COMMITTED',
      documentId: pending.body.fiscalDocumentId,
    });
    const failedBody = ticketIntent('w2b2-ticket-error');
    const signer = app.get<XmlSignerPort>(XML_SIGNER);
    const spy = jest.spyOn(signer, 'verify').mockResolvedValueOnce({
      isValid: false,
      validationErrors: ['synthetic-invalid-signature'],
    });
    await postTicket(key.secret, 'w2b2-ticket-error', failedBody).expect(422);
    spy.mockRestore();
    const failed = await lookupTicket(key.secret, 'w2b2-ticket-error', failedBody).expect(200);
    expect(failed.body.state).toBe('FAILED_TERMINAL');
    await request(app.getHttpServer())
      .get(`${ticketEndpoint()}/${failed.body.fiscalDocumentId}`)
      .set('X-API-Key', key.secret)
      .expect(200)
      .expect(({ body: status }) =>
        expect(status.errors).toEqual([{ phase: 'XML', code: expect.any(String) }]),
      );
    await postTicket(key.secret, 'w2b2-ticket-error', failedBody).expect(422);
    expect(await prisma.fiscalDocument.count({ where: { id: failed.body.fiscalDocumentId } })).toBe(
      1,
    );
  });

  it('rejects invalid TE fiscal data and enforces scopes and company isolation', async () => {
    const invalid = ticketIntent('w2b2-ticket-bad-cabys');
    invalid.lines[0].cabysCode = '123';
    await postTicket(key.secret, 'w2b2-ticket-bad-cabys', invalid).expect(400);
    const unsupported = ticketIntent('w2b2-ticket-tax-pending');
    unsupported.lines[0].taxTreatment = 'UNAPPROVED';
    await postTicket(key.secret, 'w2b2-ticket-tax-pending', unsupported).expect(422);
    expect(
      await prisma.fiscalIdempotencyKeyV2.count({
        where: { associationId, key: { in: ['w2b2-ticket-bad-cabys', 'w2b2-ticket-tax-pending'] } },
      }),
    ).toBe(0);
    const scopeAssociation = await lab.registerAssociation({
      tenantId,
      companyId,
      provider: 'AUDIT_TEST',
      externalConsumerKey: 'ticket-scope-only',
      externalCompanyKey: 'ticket-scope-issuer',
      environment: 'SANDBOX',
      actorId: adminUserId,
      correlationId: randomUUID(),
    });
    const invoiceOnly = await lab.issueKey({
      tenantId,
      associationId: scopeAssociation.associationId,
      scopes: ['fiscal-v2:invoices:create'],
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
      actorId: adminUserId,
      correlationId: randomUUID(),
    });
    await postTicket(
      invoiceOnly.secret,
      'w2b2-ticket-no-scope',
      ticketIntent('w2b2-ticket-no-scope'),
    ).expect(403);
    const own = await postTicket(
      key.secret,
      'w2b2-ticket-isolation',
      ticketIntent('w2b2-ticket-isolation'),
    ).expect(201);
    const another = await createFiscalTenantFixture(context);
    await request(app.getHttpServer())
      .get(
        `/api/v2/lab/companies/${another.companyId}/fiscal-documents/SANDBOX/tickets/${own.body.documentId}/signed-xml`,
      )
      .set('X-API-Key', key.secret)
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v2/lab/companies/${companyId}/fiscal-documents/PRODUCTION/tickets`)
      .set('X-API-Key', key.secret)
      .set('Idempotency-Key', 'w2b2-ticket-prod')
      .send(ticketIntent('w2b2-ticket-prod'))
      .expect(403);
  });

  it('queues a signed FE through the association-bound v2 HTTP contract without claiming Hacienda acceptance', async () => {
    const created = await post(
      key.secret,
      'w2b2-submit-synthetic',
      invoiceIntent('w2b2-submit-synthetic'),
    ).expect(201);
    const url = `${endpoint()}/${created.body.documentId}`;
    const submitted = await request(app.getHttpServer())
      .post(`${url}/submit`)
      .set('X-API-Key', key.secret)
      .expect(202);
    expect(submitted.body).toMatchObject({
      documentId: created.body.documentId,
      environment: 'SANDBOX',
      status: 'QUEUED',
    });
    const replay = await request(app.getHttpServer())
      .post(`${url}/submit`)
      .set('X-API-Key', key.secret)
      .expect(202);
    expect(replay.body.submissionId).toBe(submitted.body.submissionId);
    const status = await request(app.getHttpServer())
      .get(`${url}/submission`)
      .set('X-API-Key', key.secret)
      .expect(200);
    expect(status.body.status).toBe('QUEUED');
    expect(
      await prisma.fiscalSubmission.count({ where: { fiscalDocumentId: created.body.documentId } }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: {
          action: 'fiscal-v2.submission.requested',
          resource: `FiscalSubmission:${submitted.body.submissionId}`,
        },
      }),
    ).toBe(1);
    await request(app.getHttpServer())
      .get(`${endpoint()}/${randomUUID()}/submission`)
      .set('X-API-Key', key.secret)
      .expect(404);
  });

  it('shares one transactional sequence between Inventori v1 and Afiliaciones v2', async () => {
    const inventoriKey = await createFiscalApiKey(prisma, tenantId, ['invoices:write']);
    await authorizeApiKeyForCompany(prisma, inventoriKey.id, companyId);
    const before = await prisma.fiscalSequence.findFirstOrThrow({
      where: { tenantId, companyId, environment: 'SANDBOX', documentType: 'INVOICE' },
    });
    const seed = randomUUID();
    const v1 = (index: number) =>
      request(app.getHttpServer())
        .post('/api/v1/invoices')
        .set('X-API-Key', inventoriKey.secret)
        .set('Idempotency-Key', `spec10-inventori-${seed}-${index}`)
        .send(fiscalInvoicePayload(companyId));
    const v2 = (index: number) =>
      post(
        key.secret,
        `spec10-affiliations-${seed}-${index}`,
        invoiceIntent(`spec10-affiliations-${seed}-${index}`),
      );
    const results = await Promise.all([v1(1), v2(1), v1(2), v2(2)]);
    for (const result of results) expect([200, 201, 202]).toContain(result.status);
    const finalV2 = await Promise.all([v2(1), v2(2)]);
    for (const result of finalV2) expect(result.body.state).toBe('COMMITTED');
    const ids = [
      results[0].body.id,
      finalV2[0].body.documentId,
      results[2].body.id,
      finalV2[1].body.documentId,
    ] as string[];
    expect(new Set(ids).size).toBe(4);
    const docs = await prisma.fiscalDocument.findMany({
      where: { id: { in: ids } },
      select: { sequenceValue: true, consecutive: true, clave: true },
    });
    expect(docs).toHaveLength(4);
    expect(docs.map((doc) => doc.sequenceValue).sort((a, b) => Number(a - b))).toEqual([
      before.nextValue,
      before.nextValue + 1n,
      before.nextValue + 2n,
      before.nextValue + 3n,
    ]);
    expect(new Set(docs.map((doc) => doc.consecutive)).size).toBe(4);
    expect(new Set(docs.map((doc) => doc.clave)).size).toBe(4);
    const replay = await v1(1);
    expect(replay.body.id).toBe(ids[0]);
    const after = await prisma.fiscalSequence.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.nextValue).toBe(before.nextValue + 4n);
  });

  it('enforces scope, origin isolation, rotation, revocation and v1 separation', async () => {
    const own = await post(key.secret, 'w2b2-isolation', invoiceIntent('w2b2-isolation')).expect(
      201,
    );
    const otherAssociation = await lab.registerAssociation({
      tenantId,
      companyId,
      provider: 'AUDIT_TEST',
      externalConsumerKey: 'other-app',
      externalCompanyKey: 'same-issuer',
      environment: 'SANDBOX',
      actorId: adminUserId,
      correlationId: randomUUID(),
    });
    const otherKey = await lab.issueKey({
      tenantId,
      associationId: otherAssociation.associationId,
      scopes: [...scopes],
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
      actorId: adminUserId,
      correlationId: randomUUID(),
    });
    const independent = await post(
      otherKey.secret,
      'w2b2-isolation',
      invoiceIntent('w2b2-isolation'),
    ).expect(201);
    expect(independent.body.documentId).not.toBe(own.body.documentId);
    const ownXml = `${endpoint()}/${own.body.documentId}/signed-xml`;
    expect(
      (
        await prisma.fiscalDocument.findUniqueOrThrow({
          where: { id: independent.body.documentId },
        })
      ).originAssociationId,
    ).toBe(otherAssociation.associationId);
    const readOnly = await lab.issueKey({
      tenantId,
      associationId: otherAssociation.associationId,
      scopes: ['fiscal-v2:operations:read'],
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
      rotationEndsAt: new Date(Date.now() + 60_000),
      actorId: adminUserId,
      correlationId: randomUUID(),
    });
    await post(readOnly.secret, 'w2b2-readonly', invoiceIntent('w2b2-readonly')).expect(403);
    await request(app.getHttpServer())
      .post(`${endpoint()}/${own.body.documentId}/submit`)
      .set('X-API-Key', readOnly.secret)
      .expect(403);
    await request(app.getHttpServer())
      .post(`${endpoint()}/${own.body.documentId}/submit`)
      .set('X-API-Key', otherKey.secret)
      .expect(404);
    await request(app.getHttpServer())
      .get(`${endpoint()}/${own.body.documentId}`)
      .set('X-API-Key', otherKey.secret)
      .expect(404);
    await request(app.getHttpServer()).get(ownXml).set('X-API-Key', otherKey.secret).expect(404);
    await request(app.getHttpServer()).get(ownXml).set('X-API-Key', readOnly.secret).expect(404);
    const anotherCompany = await createFiscalTenantFixture(context);
    await request(app.getHttpServer())
      .get(
        `/api/v2/lab/companies/${anotherCompany.companyId}/fiscal-documents/SANDBOX/invoices/${own.body.documentId}/signed-xml`,
      )
      .set('X-API-Key', key.secret)
      .expect(404);
    await lookup(otherKey.secret, 'w2b2-isolation', invoiceIntent('w2b2-isolation')).expect(404);
    await request(app.getHttpServer())
      .post(`/api/v2/lab/companies/${companyId}/fiscal-documents/PRODUCTION/invoices`)
      .set('X-API-Key', key.secret)
      .set('Idempotency-Key', 'w2b2-production')
      .send(invoiceIntent('w2b2-production'))
      .expect(403);
    await request(app.getHttpServer())
      .get(
        `/api/v2/lab/companies/${companyId}/fiscal-documents/PRODUCTION/invoices/${own.body.documentId}/signed-xml`,
      )
      .set('X-API-Key', key.secret)
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/fiscal-documents/${own.body.documentId}/prepare-xml`)
      .set('X-API-Key', key.secret)
      .expect(403);
    await request(app.getHttpServer())
      .get(
        `/api/v1/companies/${companyId}/fiscal-documents/SANDBOX/invoices/${own.body.documentId}/artifacts`,
      )
      .set('X-API-Key', key.secret)
      .expect(403);
    const rotated = await lab.issueKey({
      tenantId,
      associationId,
      scopes: ['fiscal-v2:invoices:create'],
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
      rotationEndsAt: new Date(Date.now() + 60_000),
      actorId: adminUserId,
      correlationId: randomUUID(),
    });
    await post(rotated.secret, 'w2b2-isolation', invoiceIntent('w2b2-isolation')).expect(200);
    await request(app.getHttpServer()).get(ownXml).set('X-API-Key', rotated.secret).expect(403);
    await lab.revokeKey({
      tenantId,
      associationId,
      apiKeyId: key.apiKeyId,
      actorId: adminUserId,
      correlationId: randomUUID(),
    });
    await post(key.secret, 'w2b2-revoked', invoiceIntent('w2b2-revoked')).expect(401);
    await request(app.getHttpServer()).get(ownXml).set('X-API-Key', key.secret).expect(401);
    await post(rotated.secret, 'w2b2-isolation', invoiceIntent('w2b2-isolation')).expect(200);
    await post(readOnly.secret, 'w2b2-readonly-again', invoiceIntent('w2b2-readonly-again')).expect(
      403,
    );
  });
});
