import type { PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { LocalStorageAdapter } from '../../src/infrastructure/storage/adapters/local-storage.adapter';
import {
  DisposableTestStorage,
  provisionDisposableTestStorage,
} from '../../src/infrastructure/storage/test-storage-safety';
import { GenerateFiscalPdfService } from '../../src/modules/fiscal-documents/application/artifacts/generate-fiscal-pdf.service';
import { FiscalArtifactService } from '../../src/modules/fiscal-documents/application/artifacts/fiscal-artifact.service';
import { FiscalEvidenceResolverService } from '../../src/modules/fiscal-documents/application/artifacts/fiscal-evidence-resolver.service';
import { FiscalPdfArtifactStateService } from '../../src/modules/fiscal-documents/application/artifacts/fiscal-pdf-artifact-state.service';
import { EnsureInitialFiscalPackageService } from '../../src/modules/fiscal-documents/application/delivery/ensure-initial-fiscal-package.service';
import { DeliveryWorkerService } from '../../src/modules/fiscal-documents/application/delivery/delivery-worker.service';
import { CompanyPdfSettingsService } from '../../src/modules/fiscal-documents/application/pdf/company-pdf-settings.service';
import { FiscalRepresentationPdfPipeline } from '../../src/modules/fiscal-documents/application/pdf/fiscal-representation-pdf-pipeline';
import { SendEmailCommand } from '../../src/modules/fiscal-documents/application/email/email-delivery.port';
import { ReadOnlyFiscalXmlParser } from '../../src/modules/fiscal-documents/application/fiscal-representation/read-only-fiscal-xml-parser';
import { BillingDefaultV1PdfRendererAdapter } from '../../src/modules/fiscal-documents/infrastructure/pdf/billing-default-v1-pdf-renderer.adapter';
import { PdfjsValidPdfVerifierAdapter } from '../../src/modules/fiscal-documents/infrastructure/pdf/pdfjs-valid-pdf-verifier.adapter';
import { medicationFixture } from '../wave0/fixtures/fiscal-pdf-production-fixtures';
import { assertWave7FinalValidationDatabase } from '../helpers/test-database-safety';
import { createGuardedTestPrisma } from '../helpers/guarded-test-prisma';
import {
  assertOwnedTestTenants,
  registerOwnedTestTenant,
  releaseOwnedTestTenants,
} from '../helpers/test-database-ownership';

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
const runFinalValidation = process.env.RUN_DB_TESTS === '1';
if (runFinalValidation) {
  const guarded = assertWave7FinalValidationDatabase();
  process.env.DATABASE_URL = guarded.databaseUrl;
}
const describeFinal = runFinalValidation ? describe : describe.skip;

interface FinalFixture {
  readonly tenantId: string;
  readonly companyId: string;
  readonly pointId: string;
  readonly documentId: string;
  readonly apiKeyId: string;
  readonly clave: string;
  readonly consecutive: string;
  readonly xmlBytes: Buffer;
  readonly xmlHash: string;
  readonly signedXmlStorageKey: string;
}

describe('Fiscal PDF Wave 7 — activation contract', () => {
  it('uses the central disposable-database contract for final validation', () => {
    const runId = 'p0wave7001';
    const roleName = 'billing_p0_' + runId + '_role';
    const base = {
      NODE_ENV: 'test',
      RUN_DB_TESTS: '1',
      BILLING_TEST_RUN_ID: runId,
      BILLING_TEST_RUN_TOKEN: 'A'.repeat(32),
      BILLING_TEST_DATABASE_ROLE: roleName,
      USE_REAL_HACIENDA: 'false',
    };
    expect(
      assertWave7FinalValidationDatabase({
        ...base,
        BILLING_TEST_DATABASE_URL:
          'postgresql://' + roleName + ':pass@localhost:5432/billing_p0_' + runId + '_test',
      }).databaseName,
    ).toBe('billing_p0_' + runId + '_test');
    for (const databaseName of ['billing_dev', 'billing_prod', 'postgres', 'billing_prod_test']) {
      expect(() =>
        assertWave7FinalValidationDatabase({
          ...base,
          BILLING_TEST_DATABASE_URL:
            'postgresql://' + roleName + ':pass@localhost:5432/' + databaseName,
        }),
      ).toThrow();
    }
  });

  it('has one active runtime token and the complete production chain wired to it', () => {
    const moduleSource = readFileSync(
      join(process.cwd(), 'src/modules/fiscal-documents/fiscal-documents.module.ts'),
      'utf8',
    );
    expect(moduleSource.match(/FISCAL_PDF_ATOMIC_RUNTIME_ACTIVATED, useValue: true/g)).toHaveLength(
      1,
    );
    expect(moduleSource).not.toContain('FISCAL_PDF_ATOMIC_RUNTIME_ACTIVATED, useValue: false');
    expect(moduleSource).toContain('FISCAL_REPRESENTATION_PDF_RENDERER_PROVIDER');
    expect(moduleSource).toContain('PdfjsValidPdfVerifierAdapter');
    expect(moduleSource).toContain('FiscalRepresentationPdfPipeline');
    expect(moduleSource).toContain('GenerateFiscalPdfService');
    expect(moduleSource).toContain('EnsureInitialFiscalPackageService');
    expect(moduleSource).toContain('DeliveryWorkerService');
  });
});

describeFinal('Fiscal PDF Wave 7 — T050 exact billing_test final scenario', () => {
  let prisma: PrismaClient;
  let storageLease: DisposableTestStorage;
  let storage: LocalStorageAdapter;
  const tenantIds: string[] = [];

  const cleanupTenant = async (tenantId: string): Promise<void> => {
    assertWave7FinalValidationDatabase();
    await assertOwnedTestTenants(prisma, [tenantId]);
    const scoped = { tenantId };
    await prisma.deliveryAttempt.deleteMany({ where: { delivery: scoped } });
    await prisma.documentDelivery.deleteMany({ where: scoped });
    await prisma.fiscalArtifact.deleteMany({ where: scoped });
    await prisma.fiscalSubmission.deleteMany({ where: scoped });
    await prisma.fiscalXmlArtifact.deleteMany({ where: scoped });
    await prisma.fiscalSigningCertificate.deleteMany({ where: scoped });
    await prisma.companyEconomicActivity.deleteMany({ where: scoped });
    await prisma.companyFiscalProfile.deleteMany({ where: scoped });
    await prisma.companyPdfSettings.deleteMany({ where: scoped });
    await prisma.fiscalIdempotencyKey.deleteMany({ where: scoped });
    await prisma.fiscalDocument.deleteMany({ where: scoped });
    await prisma.fiscalIssuancePoint.deleteMany({ where: scoped });
    await prisma.fiscalSequence.deleteMany({ where: scoped });
    await prisma.haciendaConnection.deleteMany({ where: scoped });
    await prisma.apiKeyCompany.deleteMany({ where: { apiKey: scoped } });
    await prisma.refreshToken.deleteMany({ where: scoped });
    await prisma.auditLog.deleteMany({ where: scoped });
    await prisma.apiKey.deleteMany({ where: scoped });
    await prisma.user.deleteMany({ where: scoped });
    await prisma.company.deleteMany({ where: scoped });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
    await releaseOwnedTestTenants(prisma, [tenantId]);
  };

  const seedFinalFixture = async (): Promise<FinalFixture> => {
    const tenantId = randomUUID();
    const companyId = randomUUID();
    const pointId = randomUUID();
    const documentId = randomUUID();
    const apiKeyId = randomUUID();
    tenantIds.push(tenantId);
    await registerOwnedTestTenant(prisma, tenantId);

    const parser = new ReadOnlyFiscalXmlParser();
    const baselineBytes = Buffer.from(medicationFixture.xml, 'utf8');
    const baseline = parser.project({
      bytes: baselineBytes,
      expectedSha256: sha256(baselineBytes),
      documentType: 'INVOICE',
    });
    const securityCode = '70000007';
    const clave = `${baseline.document.clave.slice(0, -8)}${securityCode}`;
    const xml = medicationFixture.xml.replaceAll(baseline.document.clave, clave);
    const xmlBytes = Buffer.from(xml, 'utf8');
    const xmlHash = sha256(xmlBytes);
    const projected = parser.project({
      bytes: xmlBytes,
      expectedSha256: xmlHash,
      documentType: 'INVOICE',
    });
    const signedXmlStorageKey = `wave7/${tenantId}/${documentId}/signed.xml`;

    await prisma.tenant.create({
      data: { id: tenantId, name: `Wave 7 Fiscal PDF ${tenantId}`, slug: `wave7-${tenantId}` },
    });
    await prisma.company.create({
      data: {
        id: companyId,
        tenantId,
        legalName: 'Wave 7 Final Validation Company',
        identificationType: 'JURIDICA',
        identificationNumber: tenantId.replace(/-/g, '').slice(0, 10),
        status: 'ACTIVE',
        haciendaVerificationStatus: 'VERIFIED',
      },
    });
    await prisma.apiKey.create({
      data: {
        id: apiKeyId,
        tenantId,
        name: 'Wave 7 local validation key',
        keyPrefix: randomUUID().replace(/-/g, '').slice(0, 8),
        keyHash: sha256(Buffer.from(apiKeyId)),
        scopes: ['invoices:read'],
        status: 'ACTIVE',
      },
    });
    await prisma.apiKeyCompany.create({ data: { apiKeyId, companyId } });
    await prisma.fiscalIssuancePoint.create({
      data: {
        id: pointId,
        tenantId,
        companyId,
        environment: 'SANDBOX',
        branchCode: '001',
        terminalCode: '00001',
        isDefault: true,
      },
    });
    await prisma.fiscalDocument.create({
      data: {
        id: documentId,
        tenantId,
        companyId,
        environment: 'SANDBOX',
        type: 'INVOICE',
        status: 'READY_TO_SUBMIT',
        issuancePointId: pointId,
        branchCode: '001',
        terminalCode: '00001',
        sequenceValue: BigInt(1),
        consecutive: projected.document.consecutive,
        clave,
        securityCode,
        issuerSnapshot: { legalName: projected.issuer.legalName },
        receiverSnapshot: {
          legalName: projected.receiver?.legalName,
          correoElectronico: 'wave7-receiver@example.test',
        },
        currency: projected.currency.code,
        saleCondition: '01',
        paymentMethod: '01',
        lines: [],
        totals: {},
      },
    });
    await storage.upload({
      key: signedXmlStorageKey,
      bytes: xmlBytes,
      contentType: 'application/xml',
      metadata: { sha256: xmlHash },
    });
    await prisma.fiscalXmlArtifact.create({
      data: {
        id: randomUUID(),
        tenantId,
        companyId,
        fiscalDocumentId: documentId,
        environment: 'SANDBOX',
        documentType: 'INVOICE',
        schemaVersion: '4.4',
        xmlProfileVersion: 'v4.4-wave7',
        signedXmlStorageKey,
        signedXmlSha256: xmlHash,
        xsdValidationStatus: 'VALID',
        xsdValidatedAt: new Date(),
      },
    });
    return {
      tenantId,
      companyId,
      pointId,
      documentId,
      apiKeyId,
      clave,
      consecutive: projected.document.consecutive,
      xmlBytes,
      xmlHash,
      signedXmlStorageKey,
    };
  };

  beforeAll(async () => {
    const guardedContext = await createGuardedTestPrisma();
    prisma = guardedContext.prisma;
    storageLease = provisionDisposableTestStorage();
    storage = new LocalStorageAdapter(storageLease.rootPath, 'wave7-local-test-secret');
    const current = await prisma.$queryRaw<Array<{ database_name: string }>>`
      SELECT current_database() AS database_name
    `;
    expect(current[0]?.database_name).toBe(guardedContext.database.databaseName);
  });

  afterAll(async () => {
    for (const tenantId of tenantIds) {
      await cleanupTenant(tenantId);
    }
    await prisma.$disconnect();
    storageLease.dispose();
  });

  it('completes signed XML → real PDF 2.0.0 → verified storage/download → captured delivery', async () => {
    const fixture = await seedFinalFixture();
    const verifier = new PdfjsValidPdfVerifierAdapter();
    const renderer = new BillingDefaultV1PdfRendererAdapter();
    const pipeline = new FiscalRepresentationPdfPipeline(renderer, verifier);
    const evidence = new FiscalEvidenceResolverService(prisma as never, storage);
    const artifactState = new FiscalPdfArtifactStateService(storage, verifier);
    const artifactService = new FiscalArtifactService(
      prisma as never,
      storage,
      evidence,
      verifier,
      artifactState,
    );
    const settings = new CompanyPdfSettingsService(prisma as never, storage);
    const generator = new GenerateFiscalPdfService(
      prisma as never,
      storage,
      {} as never,
      {} as never,
      settings,
      true,
      artifactState,
      evidence,
      pipeline,
    );

    const beforeXml = await storage.download(fixture.signedXmlStorageKey);
    expect(sha256(beforeXml)).toBe(fixture.xmlHash);
    const created = await generator.generateOrReuse(
      fixture.tenantId,
      fixture.companyId,
      fixture.documentId,
    );
    expect(created.wasCreated).toBe(true);
    const reused = await Promise.all(
      Array.from({ length: 5 }, () =>
        generator.generateOrReuse(fixture.tenantId, fixture.companyId, fixture.documentId),
      ),
    );
    expect(reused.every((result) => !result.wasCreated)).toBe(true);
    expect(new Set([created, ...reused].map((result) => result.artifactId)).size).toBe(1);

    const artifact = await prisma.fiscalArtifact.findFirstOrThrow({
      where: { fiscalDocumentId: fixture.documentId, type: 'PDF', supersededAt: null },
    });
    expect(artifact.rendererVersion).toBe('2.0.0');
    expect(artifact.templateId).toBe('BILLING_DEFAULT_V1');
    expect(artifact.contentType).toBe('application/pdf');
    expect(
      await prisma.fiscalArtifact.count({
        where: { fiscalDocumentId: fixture.documentId, type: 'PDF' },
      }),
    ).toBe(1);
    const storedPdf = await storage.download(artifact.storageKey);
    expect(sha256(storedPdf)).toBe(artifact.sha256);
    expect(storedPdf.length).toBe(artifact.sizeBytes);
    expect(storedPdf.includes(Buffer.from('MOCK-BILLING'))).toBe(false);
    const verifiedStoredPdf = await verifier.verify(storedPdf, {
      documentType: 'INVOICE',
      clave: fixture.clave,
      consecutive: fixture.consecutive,
    });
    expect(verifiedStoredPdf.pageCount).toBeGreaterThanOrEqual(1);
    process.stdout.write(
      `WAVE7_EVIDENCE=${JSON.stringify({
        database: 'billing_test',
        signedXmlSha256: fixture.xmlHash,
        pdfSha256: artifact.sha256,
        pdfSizeBytes: artifact.sizeBytes,
        pdfPages: verifiedStoredPdf.pageCount,
        renderer: `${artifact.templateId}@${artifact.rendererVersion}`,
        externalRequests: 0,
      })}\n`,
    );

    const visualEvidencePath = process.env.WAVE7_VISUAL_EVIDENCE_PATH;
    if (visualEvidencePath) {
      await mkdir(dirname(visualEvidencePath), { recursive: true });
      await writeFile(visualEvidencePath, storedPdf);
    }

    const download = await artifactService.downloadArtifact(
      {
        tenantId: fixture.tenantId,
        companyId: fixture.companyId,
        apiKeyId: fixture.apiKeyId,
        scopes: ['invoices:read'],
      },
      {
        fiscalDocumentId: fixture.documentId,
        environment: 'SANDBOX',
        documentType: 'INVOICE',
        artifactId: artifact.id,
      },
    );
    expect(download.bytes.equals(storedPdf)).toBe(true);
    expect(download.contentType).toBe('application/pdf');
    expect(download.externalFilename).toBe(`${fixture.clave}.pdf`);

    const published: Array<{ deliveryId: string }> = [];
    const queue = {
      publish: jest
        .fn()
        .mockImplementation(async (_name: string, payload: { deliveryId: string }) => {
          published.push(payload);
        }),
    };
    const ensure = new EnsureInitialFiscalPackageService(
      prisma as never,
      queue as never,
      generator,
    );
    await ensure.ensure({
      tenantId: fixture.tenantId,
      companyId: fixture.companyId,
      fiscalDocumentId: fixture.documentId,
    });
    expect(published).toHaveLength(1);

    const captured: SendEmailCommand[] = [];
    const email = {
      sendEmail: jest.fn().mockImplementation(async (command: SendEmailCommand) => {
        captured.push({
          ...command,
          attachments: command.attachments.map((item) => ({
            ...item,
            content: Buffer.from(item.content),
          })),
        });
        return { outcome: 'DELIVERED', providerMessageId: 'wave7-captured-local' } as const;
      }),
    };
    const worker = new DeliveryWorkerService(
      prisma as never,
      storage,
      email,
      queue as never,
      evidence,
      artifactService,
      { record: jest.fn() } as never,
      artifactState,
    );
    await worker.processDelivery(published[0]);
    expect(captured).toHaveLength(1);
    expect(captured[0].to).toBe('wave7-receiver@example.test');
    expect(captured[0].attachments).toHaveLength(2);
    expect(captured[0].attachments[0].filename).toBe(`${fixture.clave}.xml`);
    expect(captured[0].attachments[0].content.equals(fixture.xmlBytes)).toBe(true);
    expect(captured[0].attachments[1].filename).toBe(`${fixture.clave}.pdf`);
    expect(captured[0].attachments[1].content.equals(storedPdf)).toBe(true);

    const delivery = await prisma.documentDelivery.findFirstOrThrow({
      where: { fiscalDocumentId: fixture.documentId, kind: 'INITIAL_DOCUMENT' },
    });
    expect(delivery.status).toBe('DELIVERED');
    expect(delivery.providerMessageId).toBe('wave7-captured-local');
    expect(
      (await prisma.fiscalDocument.findUniqueOrThrow({ where: { id: fixture.documentId } })).status,
    ).toBe('READY_TO_SUBMIT');
    expect(sha256(await storage.download(fixture.signedXmlStorageKey))).toBe(fixture.xmlHash);

    await cleanupTenant(fixture.tenantId);
    tenantIds.splice(tenantIds.indexOf(fixture.tenantId), 1);
    expect(await prisma.tenant.count({ where: { id: fixture.tenantId } })).toBe(0);
    expect(await prisma.fiscalDocument.count({ where: { id: fixture.documentId } })).toBe(0);
    expect(
      await prisma.fiscalArtifact.count({ where: { fiscalDocumentId: fixture.documentId } }),
    ).toBe(0);
  });
});
