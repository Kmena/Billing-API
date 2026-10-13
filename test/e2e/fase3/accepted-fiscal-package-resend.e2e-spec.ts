import * as request from 'supertest';
import { createHash, randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';
import { STORAGE_PORT, StoragePort } from '../../../src/infrastructure/storage/ports/storage.port';
import { InMemoryJobQueue } from '../../../src/infrastructure/queue/adapters/in-memory-job-queue.adapter';
import { JOB_QUEUE } from '../../../src/infrastructure/queue/ports/job-queue.port';
import { FiscalPdfArtifactStateService } from '../../../src/modules/fiscal-documents/application/artifacts/fiscal-pdf-artifact-state.service';
import {
  authorizeApiKeyForCompany,
  createFiscalApiKey,
  createFiscalE2eApp,
  createFiscalTenantFixture,
  resetFiscalE2eData,
  type FiscalE2eContext,
} from '../../helpers/fiscal-e2e-helpers';
import { createTestCompany } from '../../helpers/test-factories';

const PDF_BYTES = Buffer.from('%PDF-1.7 AFPR disposable test artifact');
const SIGNED_XML_BYTES = Buffer.from('<FacturaElectronica>signed</FacturaElectronica>');
const ACCEPTED_RESPONSE_BYTES = Buffer.from(
  '<MensajeHacienda xmlns="https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/mensajeHacienda"><Mensaje>1</Mensaje></MensajeHacienda>',
);

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

function resendPath(companyId: string, environment: 'SANDBOX' | 'PRODUCTION', documentId: string) {
  return `/api/v1/companies/${companyId}/fiscal-documents/${environment}/invoices/${documentId}/accepted-package-resend`;
}

describe('Accepted fiscal package resend (E2E, PostgreSQL)', () => {
  let context: FiscalE2eContext;
  let queue: InMemoryJobQueue;
  let publish: jest.SpyInstance;
  let pdfAssessment: jest.SpyInstance;
  let ordinal = 0;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.USE_REAL_HACIENDA = 'false';
    context = await createFiscalE2eApp();
    queue = context.app.get<InMemoryJobQueue>(JOB_QUEUE);
    await resetFiscalE2eData(context);
  });

  beforeEach(async () => {
    await resetFiscalE2eData(context);
    ordinal = 0;
    publish = jest.spyOn(queue, 'publish').mockResolvedValue(undefined);
    const artifactState = context.app.get(FiscalPdfArtifactStateService);
    pdfAssessment = jest.spyOn(artifactState, 'assess').mockImplementation(async (artifact) => ({
      state: 'VALID_REAL_CURRENT',
      artifact: artifact ?? null,
      bytes: PDF_BYTES,
    }));
  });

  afterEach(() => {
    publish.mockRestore();
    pdfAssessment.mockRestore();
  });

  afterAll(async () => {
    await resetFiscalE2eData(context);
    await context?.prisma.$disconnect();
    await context?.app.close();
  });

  async function createAcceptedFixture(
    input: {
      receiverSnapshot?: Prisma.InputJsonValue;
      status?: 'ACCEPTED' | 'READY_TO_SUBMIT';
    } = {},
  ) {
    const fixture = await createFiscalTenantFixture(context);
    const key = await createFiscalApiKey(context.prisma, fixture.tenantId, [
      'fiscal-deliveries:resend',
    ]);
    await authorizeApiKeyForCompany(context.prisma, key.id, fixture.companyId);
    const document = await seedDocument(fixture.tenantId, fixture.companyId, input);
    return { fixture, key, document };
  }

  async function seedDocument(
    tenantId: string,
    companyId: string,
    input: {
      receiverSnapshot?: Prisma.InputJsonValue;
      status?: 'ACCEPTED' | 'READY_TO_SUBMIT';
    } = {},
  ) {
    ordinal += 1;
    const id = randomUUID();
    const pointId = randomUUID();
    const sequenceValue = BigInt(ordinal);
    const consecutive = `0010000101${String(ordinal).padStart(10, '0')}`;
    const clave = `506${String(ordinal).padStart(47, '0')}`;
    const prefix = `afpr-e2e/${id}`;
    const storage = context.app.get<StoragePort>(STORAGE_PORT);
    await Promise.all([
      storage.upload({ key: `${prefix}/pdf`, bytes: PDF_BYTES, contentType: 'application/pdf' }),
      storage.upload({
        key: `${prefix}/signed.xml`,
        bytes: SIGNED_XML_BYTES,
        contentType: 'application/xml',
      }),
      storage.upload({
        key: `${prefix}/response.xml`,
        bytes: ACCEPTED_RESPONSE_BYTES,
        contentType: 'application/xml',
      }),
    ]);

    await context.prisma.fiscalIssuancePoint.create({
      data: {
        id: pointId,
        tenantId,
        companyId,
        environment: 'SANDBOX',
        branchCode: '001',
        terminalCode: '00001',
        name: 'AFPR disposable issuance point',
        active: true,
        isDefault: true,
      },
    });
    await context.prisma.fiscalDocument.create({
      data: {
        id,
        tenantId,
        companyId,
        environment: 'SANDBOX',
        type: 'INVOICE',
        status: input.status ?? 'ACCEPTED',
        issuancePointId: pointId,
        branchCode: '001',
        terminalCode: '00001',
        sequenceValue,
        consecutive,
        clave,
        securityCode: '12345678',
        issuerSnapshot: { legalName: 'AFPR E2E issuer' },
        receiverSnapshot: input.receiverSnapshot ?? { correoElectronico: 'receiver@example.test' },
        currency: 'CRC',
        saleCondition: '01',
        paymentMethod: '01',
        lines: [],
        totals: { totalComprobante: '0.00' },
      },
    });
    await context.prisma.fiscalXmlArtifact.create({
      data: {
        id: randomUUID(),
        tenantId,
        companyId,
        fiscalDocumentId: id,
        environment: 'SANDBOX',
        documentType: 'INVOICE',
        schemaVersion: '4.4',
        xmlProfileVersion: 'afpr-e2e-v1',
        signedXmlStorageKey: `${prefix}/signed.xml`,
        signedXmlSha256: sha256(SIGNED_XML_BYTES),
        xsdValidationStatus: 'VALID',
      },
    });
    await context.prisma.fiscalSubmission.create({
      data: {
        id: randomUUID(),
        tenantId,
        companyId,
        fiscalDocumentId: id,
        environment: 'SANDBOX',
        documentType: 'INVOICE',
        clave,
        signedXmlSha256: sha256(SIGNED_XML_BYTES),
        signedXmlStorageKey: `${prefix}/signed.xml`,
        status: 'ACCEPTED',
        responseStorageKey: `${prefix}/response.xml`,
        responseSha256: sha256(ACCEPTED_RESPONSE_BYTES),
        responseContentType: 'application/xml',
        acceptedAt: new Date(),
      },
    });
    await context.prisma.fiscalArtifact.create({
      data: {
        id: randomUUID(),
        tenantId,
        companyId,
        fiscalDocumentId: id,
        type: 'PDF',
        storageKey: `${prefix}/pdf`,
        sha256: sha256(PDF_BYTES),
        contentType: 'application/pdf',
        sizeBytes: PDF_BYTES.length,
        templateId: 'BILLING_DEFAULT_V1',
        rendererVersion: '1.0.0',
      },
    });
    return { id, clave, consecutive, sequenceValue, prefix };
  }

  it('authorizes an ACCEPTED package, publishes one delivery job, and preserves fiscal identity', async () => {
    const { fixture, key, document } = await createAcceptedFixture();
    const before = await context.prisma.fiscalDocument.findUniqueOrThrow({
      where: { id: document.id },
    });

    const response = await request(context.app.getHttpServer())
      .post(resendPath(fixture.companyId, 'SANDBOX', document.id))
      .set('X-API-Key', key.secret)
      .expect(202);

    expect(response.body).toMatchObject({ status: 'QUEUED', recipientDomain: 'example.test' });
    expect(publish).toHaveBeenCalledWith(
      'fiscal-document-delivery',
      { deliveryId: response.body.deliveryId },
      expect.objectContaining({
        retryLimit: 3,
        singletonKey: `fiscal-delivery:${response.body.deliveryId}`,
      }),
    );
    await expect(
      context.prisma.documentDelivery.count({
        where: { fiscalDocumentId: document.id, kind: 'ACCEPTED_FISCAL_PACKAGE' },
      }),
    ).resolves.toBe(1);
    await expect(
      context.prisma.fiscalDocument.findUniqueOrThrow({ where: { id: document.id } }),
    ).resolves.toMatchObject({
      clave: before.clave,
      consecutive: before.consecutive,
      sequenceValue: before.sequenceValue,
    });
  });

  it('denies a key without the dedicated resend scope before delivery mutation', async () => {
    const { fixture, document } = await createAcceptedFixture();
    const key = await createFiscalApiKey(context.prisma, fixture.tenantId, ['invoices:write']);
    await authorizeApiKeyForCompany(context.prisma, key.id, fixture.companyId);

    await request(context.app.getHttpServer())
      .post(resendPath(fixture.companyId, 'SANDBOX', document.id))
      .set('X-API-Key', key.secret)
      .expect(403);
    await expect(context.prisma.documentDelivery.count()).resolves.toBe(0);
  });

  it('denies a same-tenant key bound to a different company', async () => {
    const { fixture, key, document } = await createAcceptedFixture();
    const otherCompany = await createTestCompany(context.prisma, fixture.tenantId);

    await request(context.app.getHttpServer())
      .post(resendPath(otherCompany.id, 'SANDBOX', document.id))
      .set('X-API-Key', key.secret)
      .expect(403)
      .expect(({ body }) => expect(body.error.code).toBe('API_KEY_COMPANY_NOT_AUTHORIZED'));
  });

  it('does not disclose a document across tenants', async () => {
    const { fixture, document } = await createAcceptedFixture();
    const otherTenant = await createFiscalTenantFixture(context);
    const otherKey = await createFiscalApiKey(context.prisma, otherTenant.tenantId, [
      'fiscal-deliveries:resend',
    ]);
    await authorizeApiKeyForCompany(context.prisma, otherKey.id, otherTenant.companyId);

    await request(context.app.getHttpServer())
      .post(resendPath(fixture.companyId, 'SANDBOX', document.id))
      .set('X-API-Key', otherKey.secret)
      .expect(404)
      .expect(({ body }) => expect(body.error.code).toBe('COMPANY_NOT_FOUND'));
  });

  it('denies a TEST key in PRODUCTION before delivery mutation', async () => {
    const { fixture, key, document } = await createAcceptedFixture();

    await request(context.app.getHttpServer())
      .post(resendPath(fixture.companyId, 'PRODUCTION', document.id))
      .set('X-API-Key', key.secret)
      .expect(403)
      .expect(({ body }) => expect(body.error.code).toBe('API_KEY_ENVIRONMENT_NOT_AUTHORIZED'));
    await expect(context.prisma.documentDelivery.count()).resolves.toBe(0);
  });

  it('rejects a non-ACCEPTED fiscal document', async () => {
    const { fixture, key, document } = await createAcceptedFixture({ status: 'READY_TO_SUBMIT' });

    await request(context.app.getHttpServer())
      .post(resendPath(fixture.companyId, 'SANDBOX', document.id))
      .set('X-API-Key', key.secret)
      .expect(422)
      .expect(({ body }) => expect(body.error.code).toBe('FISCAL_DOCUMENT_NOT_ACCEPTED'));
  });

  it.each([
    ['missing', {}],
    ['invalid', { correoElectronico: 'not-an-email' }],
  ])(
    'rejects a %s canonical recipient before queue publication',
    async (_case, receiverSnapshot) => {
      const { fixture, key, document } = await createAcceptedFixture({ receiverSnapshot });

      await request(context.app.getHttpServer())
        .post(resendPath(fixture.companyId, 'SANDBOX', document.id))
        .set('X-API-Key', key.secret)
        .expect(422);
      expect(publish).not.toHaveBeenCalled();
      await expect(context.prisma.documentDelivery.count()).resolves.toBe(0);
    },
  );

  it('fails closed for missing and integrity-corrupt immutable evidence', async () => {
    const missing = await createAcceptedFixture();
    await context.prisma.fiscalXmlArtifact.deleteMany({
      where: { fiscalDocumentId: missing.document.id },
    });
    await request(context.app.getHttpServer())
      .post(resendPath(missing.fixture.companyId, 'SANDBOX', missing.document.id))
      .set('X-API-Key', missing.key.secret)
      .expect(422)
      .expect(({ body }) => expect(body.error.code).toBe('FISCAL_DELIVERY_SIGNED_XML_UNAVAILABLE'));

    await resetFiscalE2eData(context);
    ordinal = 0;
    const corrupt = await createAcceptedFixture();
    await context.prisma.fiscalXmlArtifact.updateMany({
      where: { fiscalDocumentId: corrupt.document.id },
      data: { signedXmlSha256: '0'.repeat(64) },
    });
    await request(context.app.getHttpServer())
      .post(resendPath(corrupt.fixture.companyId, 'SANDBOX', corrupt.document.id))
      .set('X-API-Key', corrupt.key.secret)
      .expect(422)
      .expect(({ body }) =>
        expect(body.error.code).toBe('FISCAL_DELIVERY_ARTIFACT_VALIDATION_FAILED'),
      );
    expect(publish).not.toHaveBeenCalled();
  });

  it('denies an active delivery and enforces cooldown without another publish', async () => {
    const active = await createAcceptedFixture();
    await context.prisma.documentDelivery.create({
      data: {
        id: randomUUID(),
        tenantId: active.fixture.tenantId,
        companyId: active.fixture.companyId,
        fiscalDocumentId: active.document.id,
        kind: 'ACCEPTED_FISCAL_PACKAGE',
        channel: 'EMAIL',
        recipient: 'receiver@example.test',
        status: 'SENDING',
        updatedAt: new Date(),
      },
    });
    await request(context.app.getHttpServer())
      .post(resendPath(active.fixture.companyId, 'SANDBOX', active.document.id))
      .set('X-API-Key', active.key.secret)
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('FISCAL_DELIVERY_ALREADY_IN_PROGRESS'));

    await resetFiscalE2eData(context);
    ordinal = 0;
    const cooldown = await createAcceptedFixture();
    await context.prisma.documentDelivery.create({
      data: {
        id: randomUUID(),
        tenantId: cooldown.fixture.tenantId,
        companyId: cooldown.fixture.companyId,
        fiscalDocumentId: cooldown.document.id,
        kind: 'ACCEPTED_FISCAL_PACKAGE',
        channel: 'EMAIL',
        recipient: 'receiver@example.test',
        status: 'DELIVERED',
        deliveredAt: new Date(),
        updatedAt: new Date(),
      },
    });
    await request(context.app.getHttpServer())
      .post(resendPath(cooldown.fixture.companyId, 'SANDBOX', cooldown.document.id))
      .set('X-API-Key', cooldown.key.secret)
      .expect(429)
      .expect(({ body }) => expect(body.error.code).toBe('FISCAL_DELIVERY_RESEND_THROTTLED'));
    expect(publish).not.toHaveBeenCalled();
  });

  it('makes concurrent duplicate requests create one delivery and publish once', async () => {
    const { fixture, key, document } = await createAcceptedFixture();
    const responses = await Promise.all([
      request(context.app.getHttpServer())
        .post(resendPath(fixture.companyId, 'SANDBOX', document.id))
        .set('X-API-Key', key.secret),
      request(context.app.getHttpServer())
        .post(resendPath(fixture.companyId, 'SANDBOX', document.id))
        .set('X-API-Key', key.secret),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([202, 409]);
    await expect(
      context.prisma.documentDelivery.count({
        where: { fiscalDocumentId: document.id, kind: 'ACCEPTED_FISCAL_PACKAGE' },
      }),
    ).resolves.toBe(1);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('characterizes queue publication failure: delivery remains QUEUED for existing recovery', async () => {
    const { fixture, key, document } = await createAcceptedFixture();
    publish.mockRejectedValueOnce(new Error('disposable queue unavailable'));

    await request(context.app.getHttpServer())
      .post(resendPath(fixture.companyId, 'SANDBOX', document.id))
      .set('X-API-Key', key.secret)
      .expect(202);

    await expect(
      context.prisma.documentDelivery.findFirstOrThrow({
        where: { fiscalDocumentId: document.id, kind: 'ACCEPTED_FISCAL_PACKAGE' },
      }),
    ).resolves.toMatchObject({
      status: 'QUEUED',
      lastErrorCode: 'QUEUE_PUBLICATION_FAILED',
    });
  });
});
