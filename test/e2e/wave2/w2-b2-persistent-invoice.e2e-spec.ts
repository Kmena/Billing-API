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
import { W2B2FiscalLabModule } from '../../../src/modules/fiscal-intent-v2/w2-b2-fiscal-lab.module';
import { W2B2LabInvoiceService } from '../../../src/modules/fiscal-intent-v2/w2-b2-lab-invoice.service';
import {
  projectW2BInvoiceLab,
  W2B_LAB_HASH_VERSION,
} from '../../../src/modules/fiscal-intent-v2/w2-b-lab-projection';
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
const scopes = ['fiscal-v2:invoices:create', 'fiscal-v2:operations:read'] as const;

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

describe('W2-B2 persistent fiscal creation in disposable PostgreSQL', () => {
  jest.setTimeout(120000);
  let context: FiscalE2eContext;
  let app: INestApplication;
  let prisma: PrismaClient;
  let lab: ConsumerV2LabService;
  let invoices: W2B2LabInvoiceService;
  let tenantId: string;
  let companyId: string;
  let consumerId: string;
  let associationId: string;
  let key: { apiKeyId: string; secret: string };
  const endpoint = () => `/api/v2/lab/companies/${companyId}/fiscal-documents/SANDBOX/invoices`;
  const post = (secret: string, keyValue: string, body: ReturnType<typeof invoiceIntent>) =>
    request(app.getHttpServer())
      .post(endpoint())
      .set('X-API-Key', secret)
      .set('Idempotency-Key', keyValue)
      .send(body);
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
    companyId = fixture.companyId;
    await createEnabledHaciendaConnection(prisma, tenantId, companyId);
    await configureValidCompanyFiscalProfile(context, fixture);
    await configureDefaultFiscalSetup(context, fixture, 'INVOICE');
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
    const created = await post(key.secret, 'w2b2-create-1', invoiceIntent('w2b2-create-1')).expect(
      201,
    );
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
      actorId: randomUUID(),
      correlationId: randomUUID(),
    });
    const otherKey = await lab.issueKey({
      tenantId,
      associationId: otherAssociation.associationId,
      scopes: [...scopes],
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
      actorId: randomUUID(),
      correlationId: randomUUID(),
    });
    const independent = await post(
      otherKey.secret,
      'w2b2-isolation',
      invoiceIntent('w2b2-isolation'),
    ).expect(201);
    expect(independent.body.documentId).not.toBe(own.body.documentId);
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
      actorId: randomUUID(),
      correlationId: randomUUID(),
    });
    await post(readOnly.secret, 'w2b2-readonly', invoiceIntent('w2b2-readonly')).expect(403);
    await request(app.getHttpServer())
      .get(`${endpoint()}/${own.body.documentId}`)
      .set('X-API-Key', otherKey.secret)
      .expect(404);
    await lookup(otherKey.secret, 'w2b2-isolation', invoiceIntent('w2b2-isolation')).expect(404);
    await request(app.getHttpServer())
      .post(`/api/v2/lab/companies/${companyId}/fiscal-documents/PRODUCTION/invoices`)
      .set('X-API-Key', key.secret)
      .set('Idempotency-Key', 'w2b2-production')
      .send(invoiceIntent('w2b2-production'))
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/fiscal-documents/${own.body.documentId}/prepare-xml`)
      .set('X-API-Key', key.secret)
      .expect(403);
    const rotated = await lab.issueKey({
      tenantId,
      associationId,
      scopes: [...scopes],
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
      rotationEndsAt: new Date(Date.now() + 60_000),
      actorId: randomUUID(),
      correlationId: randomUUID(),
    });
    await post(rotated.secret, 'w2b2-isolation', invoiceIntent('w2b2-isolation')).expect(200);
    await lab.revokeKey({
      tenantId,
      associationId,
      apiKeyId: key.apiKeyId,
      actorId: randomUUID(),
      correlationId: randomUUID(),
    });
    await post(key.secret, 'w2b2-revoked', invoiceIntent('w2b2-revoked')).expect(401);
    await post(rotated.secret, 'w2b2-isolation', invoiceIntent('w2b2-isolation')).expect(200);
    await post(readOnly.secret, 'w2b2-readonly-again', invoiceIntent('w2b2-readonly-again')).expect(
      403,
    );
  });
});
