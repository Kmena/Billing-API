import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { LocalStorageAdapter } from '../../src/infrastructure/storage/adapters/local-storage.adapter';
import {
  DisposableTestStorage,
  provisionDisposableTestStorage,
} from '../../src/infrastructure/storage/test-storage-safety';
import { StoragePort } from '../../src/infrastructure/storage/ports/storage.port';
import {
  FiscalDocumentType,
  FiscalRepresentationView,
  ReadOnlyFiscalXmlParser,
} from '../../src/modules/fiscal-documents/application/fiscal-representation/read-only-fiscal-xml-parser';
import { BillingDefaultV1PdfRendererAdapter } from '../../src/modules/fiscal-documents/infrastructure/pdf/billing-default-v1-pdf-renderer.adapter';
import { PdfjsValidPdfVerifierAdapter } from '../../src/modules/fiscal-documents/infrastructure/pdf/pdfjs-valid-pdf-verifier.adapter';
import { FiscalRepresentationPdfPipeline } from '../../src/modules/fiscal-documents/application/pdf/fiscal-representation-pdf-pipeline';
import { PDF_MAX_SIZE_BYTES_DEFAULT } from '../../src/modules/fiscal-documents/application/pdf/valid-pdf-verifier.port';
import {
  FiscalPdfArtifactStateService,
  PersistedPdfArtifact,
} from '../../src/modules/fiscal-documents/application/artifacts/fiscal-pdf-artifact-state.service';
import { FiscalEvidenceResolverService } from '../../src/modules/fiscal-documents/application/artifacts/fiscal-evidence-resolver.service';
import { FiscalArtifactService } from '../../src/modules/fiscal-documents/application/artifacts/fiscal-artifact.service';
import { GenerateFiscalPdfService } from '../../src/modules/fiscal-documents/application/artifacts/generate-fiscal-pdf.service';
import { DeliveryWorkerService } from '../../src/modules/fiscal-documents/application/delivery/delivery-worker.service';
import { EnsureInitialFiscalPackageService } from '../../src/modules/fiscal-documents/application/delivery/ensure-initial-fiscal-package.service';
import { SendEmailCommand } from '../../src/modules/fiscal-documents/application/email/email-delivery.port';
import {
  medicationFixture,
  multipageFixture,
} from '../wave0/fixtures/fiscal-pdf-production-fixtures';
import { assertSafeTestDatabase } from '../helpers/test-database-safety';

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
const fixtureDirectory = join(
  process.cwd(),
  'src',
  'modules',
  'fiscal-documents',
  'infrastructure',
  'xml',
  '__tests__',
  'fixtures',
);
const teXml = readFileSync(join(fixtureDirectory, 'valid-tiquete-electronico-v44.xml'), 'utf8');

interface IntegratedResult {
  readonly xmlBytes: Buffer;
  readonly xmlHash: string;
  readonly view: FiscalRepresentationView;
  readonly pdfBytes: Buffer;
  readonly pdfText: string;
  readonly pageCount: number;
  readonly artifact: PersistedPdfArtifact & {
    tenantId: string;
    companyId: string;
    fiscalDocumentId: string;
    type: 'PDF';
    contentType: 'application/pdf';
    createdAt: Date;
    supersededAt: null;
  };
  readonly storage: LocalStorageAdapter;
  readonly artifactState: FiscalPdfArtifactStateService;
}

describe('Fiscal PDF Wave 6 — integrated atomic-path verification', () => {
  let storageLease: DisposableTestStorage;
  let storage: LocalStorageAdapter;
  const parser = new ReadOnlyFiscalXmlParser();
  const renderer = new BillingDefaultV1PdfRendererAdapter();
  const verifier = new PdfjsValidPdfVerifierAdapter();
  const pipeline = new FiscalRepresentationPdfPipeline(renderer, verifier);

  beforeAll(() => {
    storageLease = provisionDisposableTestStorage();
    storage = new LocalStorageAdapter(storageLease.rootPath, 'wave6-test-secret');
  });

  afterAll(() => {
    storageLease.dispose();
  });

  const integrate = async (
    xml: string,
    documentType: FiscalDocumentType,
    suffix: string,
  ): Promise<IntegratedResult> => {
    const xmlBytes = Buffer.from(xml, 'utf8');
    const original = Buffer.from(xmlBytes);
    const xmlHash = sha256(xmlBytes);
    const view = parser.project({ bytes: xmlBytes, expectedSha256: xmlHash, documentType });
    const verified = await pipeline.generateVerified(view, {
      timeoutMs: 30_000,
      limits: { maxSizeBytes: PDF_MAX_SIZE_BYTES_DEFAULT },
      render: { qr: { enabled: false } },
    });
    expect(xmlBytes.equals(original)).toBe(true);
    expect(sha256(xmlBytes)).toBe(xmlHash);
    expect(verified.rendered.templateId).toBe('BILLING_DEFAULT_V1');
    expect(verified.rendered.rendererVersion).toBe('2.0.0');
    expect(verified.rendered.bytes.includes(Buffer.from('MOCK-BILLING'))).toBe(false);
    expect(verified.verified.pageCount).toBeGreaterThanOrEqual(1);
    expect(verified.rendered.bytes.length).toBeLessThanOrEqual(PDF_MAX_SIZE_BYTES_DEFAULT);

    const key = `wave6/${suffix}/${verified.rendered.sha256}.pdf`;
    await storage.upload({
      key,
      bytes: verified.rendered.bytes,
      contentType: 'application/pdf',
      metadata: { sha256: verified.rendered.sha256 },
    });
    const artifact = {
      id: `artifact-${suffix}`,
      tenantId: 'tenant-wave6',
      companyId: 'company-wave6',
      fiscalDocumentId: `document-${suffix}`,
      type: 'PDF' as const,
      storageKey: key,
      sha256: verified.rendered.sha256,
      sizeBytes: verified.rendered.sizeBytes,
      contentType: 'application/pdf' as const,
      templateId: verified.rendered.templateId,
      rendererVersion: verified.rendered.rendererVersion,
      createdAt: new Date('2026-10-06T00:00:00Z'),
      supersededAt: null,
    };
    const artifactState = new FiscalPdfArtifactStateService(storage, verifier);
    await expect(
      artifactState.assess(artifact, {
        documentType: view.document.type,
        clave: view.document.clave,
        consecutive: view.document.consecutive,
      }),
    ).resolves.toMatchObject({ state: 'VALID_REAL_CURRENT' });

    const prisma = {
      company: { findFirst: jest.fn().mockResolvedValue({ id: 'company-wave6' }) },
      apiKeyCompany: { findUnique: jest.fn().mockResolvedValue({ id: 'binding-wave6' }) },
      fiscalDocument: {
        findFirst: jest.fn().mockResolvedValue({
          clave: view.document.clave,
          consecutive: view.document.consecutive,
          type: view.document.type,
        }),
      },
      fiscalArtifact: {
        findFirst: jest.fn().mockResolvedValue(artifact),
        findMany: jest.fn().mockResolvedValue([artifact]),
      },
    };
    const evidence = new FiscalEvidenceResolverService(prisma as never, storage);
    const artifacts = new FiscalArtifactService(
      prisma as never,
      storage,
      evidence,
      verifier,
      artifactState,
    );
    const download = await artifacts.downloadArtifact(
      {
        tenantId: 'tenant-wave6',
        companyId: 'company-wave6',
        apiKeyId: 'api-key-wave6',
        scopes: [documentType === 'INVOICE' ? 'invoices:read' : 'tickets:read'],
      },
      {
        fiscalDocumentId: artifact.fiscalDocumentId,
        environment: 'SANDBOX',
        documentType,
        artifactId: artifact.id,
      },
    );
    expect(download.contentType).toBe('application/pdf');
    expect(download.bytes.equals(verified.rendered.bytes)).toBe(true);
    expect((await storage.download(key)).equals(verified.rendered.bytes)).toBe(true);

    return {
      xmlBytes,
      xmlHash,
      view,
      pdfBytes: verified.rendered.bytes,
      pdfText: verified.verified.normalizedText,
      pageCount: verified.verified.pageCount,
      artifact,
      storage,
      artifactState,
    };
  };

  it('runs FE XML → projection → real PDF → verifier → storage → download', async () => {
    const result = await integrate(medicationFixture.xml, 'INVOICE', 'fe');
    const line = result.view.lines[0];
    [
      result.view.document.clave,
      result.view.document.consecutive,
      result.view.issuer.legalName,
      result.view.receiver?.legalName,
      result.view.document.issuerActivityCode,
      result.view.currency.code,
      line.cabys,
      line.quantity.canonical,
      line.unit,
      line.unitPrice.canonical,
      line.taxes[0].code,
      line.taxes[0].rate?.canonical,
      line.taxes[0].amount.canonical,
      line.lineTotal.canonical,
      result.view.summary.tax?.canonical,
      result.view.summary.total.canonical,
    ].forEach((value) => expect(result.pdfText).toContain(value));
  });

  it('runs TE without inventing the FE-only TipoTransaccion field', async () => {
    const result = await integrate(teXml, 'TICKET', 'te');
    expect(result.view.document.type).toBe('TICKET');
    expect(
      result.view.projectedFields.some((field) => field.elementName === 'TipoTransaccion'),
    ).toBe(false);
    expect(result.pdfText).toContain('Tiquete Electrónico');
    expect(result.pdfText).not.toContain('Tipo transacción');
  });

  it('preserves medication fields through XML, projection, PDF, storage and download', async () => {
    const result = await integrate(medicationFixture.xml, 'INVOICE', 'medication');
    const line = result.view.lines[0];
    expect(line.cabys).toBe('1234567890123');
    expect(result.pdfText).toContain(line.cabys);
    expect(result.pdfText).toContain(line.medicationRegistration);
    expect(result.pdfText).toContain(line.pharmaceuticalForm);
  });

  it('preserves all 30 lines in order across multiple verified PDF pages', async () => {
    const result = await integrate(multipageFixture.xml, 'INVOICE', 'multipage');
    expect(result.view.lines).toHaveLength(30);
    expect(result.pageCount).toBeGreaterThan(1);
    const positions = result.view.lines.map((line) => result.pdfText.indexOf(line.detail));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(
      positions.every((position, index) => index === 0 || position > positions[index - 1]),
    ).toBe(true);
  });

  it('generates once and reuses the same fully verified current artifact', async () => {
    const xmlBytes = Buffer.from(medicationFixture.xml);
    const view = parser.project({
      bytes: xmlBytes,
      expectedSha256: sha256(xmlBytes),
      documentType: 'INVOICE',
    });
    let persisted: (IntegratedResult['artifact'] & { environment?: string }) | null = null;
    const prisma = {
      fiscalDocument: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'document-reuse',
          tenantId: 'tenant-wave6',
          companyId: 'company-wave6',
          type: 'INVOICE',
          clave: view.document.clave,
          consecutive: view.document.consecutive,
          environment: 'SANDBOX',
        }),
      },
      fiscalArtifact: {
        findFirst: jest.fn().mockImplementation(async () => persisted),
        create: jest.fn().mockImplementation(async ({ data }) => {
          persisted = { ...data, createdAt: new Date(), supersededAt: null };
          return persisted;
        }),
      },
      fiscalXmlArtifact: {
        findFirst: jest.fn().mockResolvedValue({
          signedXmlStorageKey: 'wave6/reuse/signed.xml',
          signedXmlSha256: sha256(xmlBytes),
        }),
      },
    };
    await storage.upload({
      key: 'wave6/reuse/signed.xml',
      bytes: xmlBytes,
      contentType: 'application/xml',
    });
    const evidence = new FiscalEvidenceResolverService(prisma as never, storage);
    const state = new FiscalPdfArtifactStateService(storage, verifier);
    const renderSpy = jest.spyOn(renderer, 'renderRepresentation');
    try {
      const service = new GenerateFiscalPdfService(
        prisma as never,
        storage,
        {} as never,
        {} as never,
        {
          getBrandingView: jest.fn().mockResolvedValue({
            templateId: 'BILLING_DEFAULT_V1',
            showCommercialName: false,
          }),
        } as never,
        true,
        state,
        evidence,
        pipeline,
      );
      const first = await service.generateOrReuse(
        'tenant-wave6',
        'company-wave6',
        'document-reuse',
      );
      const second = await service.generateOrReuse(
        'tenant-wave6',
        'company-wave6',
        'document-reuse',
      );
      expect(first.wasCreated).toBe(true);
      expect(second).toEqual({ ...first, wasCreated: false });
      expect(prisma.fiscalArtifact.create).toHaveBeenCalledTimes(1);
      expect(renderSpy).toHaveBeenCalledTimes(1);
      const persistedArtifact = persisted as unknown as IntegratedResult['artifact'];
      expect(persistedArtifact.rendererVersion).toBe('2.0.0');
      expect(persistedArtifact.sha256).toBe(first.sha256);
    } finally {
      renderSpy.mockRestore();
    }
  });

  const makeDeliveryWorker = (params: {
    kind?: 'INITIAL_DOCUMENT' | 'HACIENDA_RESPONSE';
    documentType?: 'INVOICE' | 'TICKET';
    clave: string;
    consecutive: string;
    storage: StoragePort;
    artifact: PersistedPdfArtifact | null;
    signedXml: Buffer;
    responseXml?: Buffer;
  }) => {
    const sendEmail = jest.fn().mockResolvedValue({
      outcome: 'DELIVERED',
      providerMessageId: 'captured-wave6',
    });
    const updates: Array<Record<string, unknown>> = [];
    const delivery = {
      id: 'delivery-wave6',
      tenantId: 'tenant-wave6',
      companyId: 'company-wave6',
      fiscalDocumentId: 'document-wave6',
      kind: params.kind ?? 'INITIAL_DOCUMENT',
      channel: 'EMAIL',
      recipient: 'receiver@example.test',
      status: 'QUEUED',
      attemptCount: 0,
      fiscalDocument: {
        id: 'document-wave6',
        tenantId: 'tenant-wave6',
        companyId: 'company-wave6',
        clave: params.clave,
        consecutive: params.consecutive,
        type: params.documentType ?? 'INVOICE',
        status: 'READY_TO_SUBMIT',
      },
    };
    const prisma = {
      documentDelivery: {
        findUnique: jest.fn().mockResolvedValue(delivery),
        updateMany: jest.fn().mockImplementation(async ({ data }) => {
          updates.push(data);
          return { count: 1 };
        }),
      },
      deliveryAttempt: {
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
      fiscalArtifact: { findFirst: jest.fn().mockResolvedValue(params.artifact) },
      fiscalXmlArtifact: {
        findFirst: jest.fn().mockResolvedValue({
          signedXmlStorageKey: 'signed.xml',
          signedXmlSha256: sha256(params.signedXml),
        }),
      },
      fiscalSubmission: {
        findFirst: jest.fn().mockResolvedValue(
          params.responseXml
            ? {
                responseStorageKey: 'response.xml',
                responseSha256: sha256(params.responseXml),
                responseContentType: 'application/xml',
              }
            : null,
        ),
      },
    };
    const evidence = new FiscalEvidenceResolverService(prisma as never, params.storage);
    const state = new FiscalPdfArtifactStateService(params.storage, verifier);
    const worker = new DeliveryWorkerService(
      prisma as never,
      params.storage,
      { sendEmail } as never,
      {} as never,
      evidence,
      {} as never,
      { record: jest.fn() } as never,
      state,
    );
    return { worker, sendEmail, updates };
  };

  it('delivers byte-identical signed XML and current verified PDF through captured email', async () => {
    const result = await integrate(medicationFixture.xml, 'INVOICE', 'delivery-positive');
    await storage.upload({
      key: 'signed.xml',
      bytes: result.xmlBytes,
      contentType: 'application/xml',
    });
    const { worker, sendEmail, updates } = makeDeliveryWorker({
      clave: result.view.document.clave,
      consecutive: result.view.document.consecutive,
      storage,
      artifact: result.artifact,
      signedXml: result.xmlBytes,
    });
    await worker.processDelivery({ deliveryId: 'delivery-wave6' });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const command = sendEmail.mock.calls[0][0] as SendEmailCommand;
    expect(command.attachments).toHaveLength(2);
    expect(command.attachments[0].content.equals(result.xmlBytes)).toBe(true);
    expect(command.attachments[0].contentType).toBe('application/xml');
    expect(command.attachments[1].content.equals(result.pdfBytes)).toBe(true);
    expect(command.attachments[1].contentType).toBe('application/pdf');
    expect(updates.at(-1)).toMatchObject({ status: 'DELIVERED' });
  });

  const oversizedPdf = Buffer.alloc(PDF_MAX_SIZE_BYTES_DEFAULT + 1, 0x20);
  oversizedPdf.write('%PDF-', 0, 'ascii');

  it.each([
    ['missing', null, undefined, 'RETRY_PENDING', 'ARTIFACT_MISSING'],
    [
      'historical mock',
      { rendererVersion: '1.0.0' },
      Buffer.from('%PDF-1.4-MOCK-BILLING historical'),
      'FAILED',
      'LEGACY_PDF_UNAVAILABLE',
    ],
    ['wrong version', { rendererVersion: '3.0.0' }, undefined, 'FAILED', 'ARTIFACT_WRONG_VERSION'],
    ['hash mismatch', { sha256: '0'.repeat(64) }, undefined, 'FAILED', 'ARTIFACT_HASH_MISMATCH'],
    ['corrupt', {}, Buffer.from('%PDF-1.4\ntruncated'), 'FAILED', 'PDF_INVALID_STRUCTURE'],
    ['oversized', {}, oversizedPdf, 'FAILED', 'PDF_OVERSIZED'],
  ] as const)(
    'blocks INITIAL_DOCUMENT SMTP for %s PDF',
    async (_label, override, bytesOverride, expectedStatus, expectedCode) => {
      const valid = await pipeline.generateVerified(
        parser.project({
          bytes: Buffer.from(medicationFixture.xml),
          expectedSha256: sha256(Buffer.from(medicationFixture.xml)),
          documentType: 'INVOICE',
        }),
        { timeoutMs: 30_000, limits: { maxSizeBytes: PDF_MAX_SIZE_BYTES_DEFAULT } },
      );
      const pdfBytes = bytesOverride ?? valid.rendered.bytes;
      const artifact =
        override === null
          ? null
          : {
              id: 'artifact-negative',
              storageKey: 'negative.pdf',
              sha256: sha256(pdfBytes),
              sizeBytes: pdfBytes.length,
              templateId: 'BILLING_DEFAULT_V1',
              rendererVersion: '2.0.0',
              ...(override ?? {}),
            };
      const signedXml = Buffer.from(medicationFixture.xml);
      const objects = new Map<string, Buffer>([
        ['signed.xml', signedXml],
        ['negative.pdf', pdfBytes],
      ]);
      const memoryStorage = {
        download: jest.fn().mockImplementation(async (key: string) => {
          const value = objects.get(key);
          if (!value) throw new Error('missing object');
          return value;
        }),
      } as unknown as StoragePort;
      const view = parser.project({
        bytes: signedXml,
        expectedSha256: sha256(signedXml),
        documentType: 'INVOICE',
      });
      const { worker, sendEmail, updates } = makeDeliveryWorker({
        clave: view.document.clave,
        consecutive: view.document.consecutive,
        storage: memoryStorage,
        artifact,
        signedXml,
      });
      await worker.processDelivery({ deliveryId: 'delivery-wave6' });
      expect(sendEmail).not.toHaveBeenCalled();
      expect(updates.at(-1)).toMatchObject({ status: expectedStatus, lastErrorCode: expectedCode });
    },
  );

  it('blocks SMTP when PDF identity validation fails', async () => {
    const result = await integrate(medicationFixture.xml, 'INVOICE', 'identity-failure');
    await storage.upload({
      key: 'signed.xml',
      bytes: result.xmlBytes,
      contentType: 'application/xml',
    });
    const { worker, sendEmail, updates } = makeDeliveryWorker({
      clave: result.view.document.clave,
      consecutive: '99999999999999999999',
      storage,
      artifact: result.artifact,
      signedXml: result.xmlBytes,
    });
    await worker.processDelivery({ deliveryId: 'delivery-wave6' });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(updates.at(-1)).toMatchObject({
      status: 'FAILED',
      lastErrorCode: 'PDF_INVALID_STRUCTURE',
    });
  });

  it('records generation failure as bounded retry without queueing or SMTP', async () => {
    const create = jest.fn().mockResolvedValue({});
    const publish = jest.fn();
    const service = new EnsureInitialFiscalPackageService(
      {
        fiscalDocument: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'document-wave6',
            tenantId: 'tenant-wave6',
            companyId: 'company-wave6',
            status: 'READY_TO_SUBMIT',
            type: 'INVOICE',
            receiverSnapshot: { correoElectronico: 'receiver@example.test' },
            xmlArtifacts: [{ signedXmlStorageKey: 'signed.xml', signedXmlSha256: 'a'.repeat(64) }],
          }),
        },
        documentDelivery: { findFirst: jest.fn().mockResolvedValue(null), create },
      } as never,
      { publish } as never,
      { generateOrReuse: jest.fn().mockRejectedValue(new Error('renderer unavailable')) } as never,
    );
    await service.ensure({
      tenantId: 'tenant-wave6',
      companyId: 'company-wave6',
      fiscalDocumentId: 'document-wave6',
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'RETRY_PENDING', lastErrorCode: 'RENDER_FAILED' }),
    });
    expect(publish).not.toHaveBeenCalled();
  });

  it('keeps HACIENDA_RESPONSE independent from the INITIAL_DOCUMENT PDF gate', async () => {
    const responseXml = Buffer.from('<MensajeHacienda>aceptado</MensajeHacienda>');
    const signedXml = Buffer.from(medicationFixture.xml);
    const objects = new Map<string, Buffer>([['response.xml', responseXml]]);
    const responseStorage = {
      download: jest.fn().mockImplementation(async (key: string) => {
        const value = objects.get(key);
        if (!value) throw new Error('missing object');
        return value;
      }),
    } as unknown as StoragePort;
    const view = parser.project({
      bytes: signedXml,
      expectedSha256: sha256(signedXml),
      documentType: 'INVOICE',
    });
    const { worker, sendEmail } = makeDeliveryWorker({
      kind: 'HACIENDA_RESPONSE',
      clave: view.document.clave,
      consecutive: view.document.consecutive,
      storage: responseStorage,
      artifact: null,
      signedXml,
      responseXml,
    });
    await worker.processDelivery({ deliveryId: 'delivery-wave6' });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const command = sendEmail.mock.calls[0][0] as SendEmailCommand;
    expect(command.attachments).toHaveLength(1);
    expect(command.attachments[0].content.equals(responseXml)).toBe(true);
  });

  it('proves the central disposable DB guard matrix without creating Prisma', () => {
    const runId = 'p0wave6001';
    const roleName = 'billing_p0_' + runId + '_role';
    const valid = {
      NODE_ENV: 'test',
      RUN_DB_TESTS: '1',
      BILLING_TEST_RUN_ID: runId,
      BILLING_TEST_RUN_TOKEN: 'A'.repeat(32),
      BILLING_TEST_DATABASE_ROLE: roleName,
      USE_REAL_HACIENDA: 'false',
      BILLING_TEST_DATABASE_URL:
        'postgresql://' + roleName + ':pass@localhost:5432/billing_p0_' + runId + '_test',
    };

    expect(() => assertSafeTestDatabase({})).toThrow('NODE_ENV=test');
    expect(() =>
      assertSafeTestDatabase({
        ...valid,
        BILLING_TEST_DATABASE_URL: undefined,
        DATABASE_URL: 'postgresql://billing:pass@localhost:5432/billing_dev',
      }),
    ).toThrow('BILLING_TEST_DATABASE_URL');
    for (const database of ['billing_dev', 'billing_prod', 'postgres', 'billing_prod_test']) {
      expect(() =>
        assertSafeTestDatabase({
          ...valid,
          BILLING_TEST_DATABASE_URL:
            'postgresql://' + roleName + ':pass@localhost:5432/' + database,
        }),
      ).toThrow();
    }
    expect(assertSafeTestDatabase(valid).databaseName).toBe('billing_p0_' + runId + '_test');
  });

  it('keeps the complete safety floor behind one atomically activated runtime token', () => {
    const moduleSource = readFileSync(
      join(process.cwd(), 'src/modules/fiscal-documents/fiscal-documents.module.ts'),
      'utf8',
    );
    const generatorSource = readFileSync(
      join(
        process.cwd(),
        'src/modules/fiscal-documents/application/artifacts/generate-fiscal-pdf.service.ts',
      ),
      'utf8',
    );
    const workerSource = readFileSync(
      join(
        process.cwd(),
        'src/modules/fiscal-documents/application/delivery/delivery-worker.service.ts',
      ),
      'utf8',
    );
    expect(moduleSource).toContain('FISCAL_REPRESENTATION_PDF_RENDERER_PROVIDER');
    expect(moduleSource).toContain('PdfjsValidPdfVerifierAdapter');
    expect(moduleSource).toContain('FISCAL_PDF_ATOMIC_RUNTIME_ACTIVATED, useValue: true');
    expect(moduleSource.match(/FISCAL_PDF_ATOMIC_RUNTIME_ACTIVATED, useValue: true/g)).toHaveLength(
      1,
    );
    expect(generatorSource).toContain('resolveSignedXmlBytes');
    expect(generatorSource).toContain('ReadOnlyFiscalXmlParser');
    expect(generatorSource).toContain('pipeline.generateVerified');
    expect(workerSource).toContain('requireCurrent');
    expect(workerSource).toContain("delivery.kind === 'INITIAL_DOCUMENT'");
  });
});
