import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';
import { AppModule } from '../../../src/app.module';
import { GlobalExceptionFilter } from '../../../src/api/filters/global-exception.filter';
import { configureApiPrefixes } from '../../../src/bootstrap/api-prefix';
import {
  SECRET_PROVIDER,
  SecretProvider,
} from '../../../src/infrastructure/secrets/ports/secret-provider.port';
import { STORAGE_PORT, StoragePort } from '../../../src/infrastructure/storage/ports/storage.port';
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

const execute = promisify(execFile);
const signing = createTestSigningMaterial();
const scopes = [
  'fiscal-v2:invoices:create',
  'fiscal-v2:credit-notes:create',
  'fiscal-v2:debit-notes:create',
  'fiscal-v2:operations:read',
] as const;

const crossLabEnabled = Boolean(
  process.env.AFILIACIONES_W5_ROOT &&
  process.env.W5_TEST_DATABASE_URL &&
  process.env.SPEC08_W2B_RUN_TOKEN,
);

(crossLabEnabled ? describe : describe.skip)(
  'W5 Afiliaciones -> Billing real HTTP laboratory',
  () => {
    jest.setTimeout(180000);
    let app: INestApplication;
    let prisma: PrismaClient;
    let context: FiscalE2eContext;
    let companyId: string;
    let key: string;
    let billingBase: string;
    async function adapter(
      action: string,
      input: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
      const root = process.env.AFILIACIONES_W5_ROOT;
      if (!root) throw new Error('AFILIACIONES_W5_ROOT is required');
      const child = await execute(
        process.execPath,
        [join(root, 'scripts/w5-corrections-adapter.mjs')],
        {
          cwd: root,
          timeout: 60000,
          windowsHide: true,
          env: {
            ...process.env,
            W5_BILLING_LAB_URL: `${billingBase}/`,
            W5_BILLING_COMPANY_ID: companyId,
            W5_BILLING_API_KEY: key,
            W5_ADAPTER_ACTION: action,
            W5_ADAPTER_INPUT: JSON.stringify(input),
          },
        },
      );
      const matched = child.stdout.match(/W5_ADAPTER_RESULT (\{[^\n]+\})/);
      if (!matched)
        throw new Error(`Billing adapter did not report success: ${child.stderr || child.stdout}`);
      return JSON.parse(matched[1]) as Record<string, unknown>;
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
      await app.listen(0, '127.0.0.1');
      billingBase = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
      context = { app, prisma, ownedTenantIds: new Set<string>() };
      const lab = app.get(ConsumerV2LabService);
      const fixture = await createFiscalTenantFixture(context);
      companyId = fixture.companyId;
      await createEnabledHaciendaConnection(prisma, fixture.tenantId, companyId);
      await configureValidCompanyFiscalProfile(context, fixture);
      await configureDefaultFiscalSetup(context, fixture, 'INVOICE');
      const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
      const secretRef = `W5_TEST_CERT_${companyId.replace(/-/g, '_')}`;
      const passRef = `W5_TEST_PASS_${companyId.replace(/-/g, '_')}`;
      const secrets = app.get<SecretProvider>(SECRET_PROVIDER);
      await secrets.storeSecret(secretRef, JSON.stringify({ pkcs12Base64: signing.pkcs12Base64 }));
      await secrets.storeSecret(passRef, signing.certificate.passphrase);
      await prisma.fiscalSigningCertificate.create({
        data: {
          id: randomUUID(),
          tenantId: fixture.tenantId,
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
        tenantId: fixture.tenantId,
        companyId,
        provider: 'PARTNER',
        externalConsumerKey: 'synthetic-w5-afiliaciones',
        externalCompanyKey: 'synthetic-w5-issuer',
        environment: 'SANDBOX',
        actorId: fixture.userId,
        correlationId: randomUUID(),
      });
      const issued = await lab.issueKey({
        tenantId: fixture.tenantId,
        associationId: association.associationId,
        scopes: [...scopes],
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
        actorId: fixture.userId,
        correlationId: randomUUID(),
      });
      key = issued.secret;
    });
    afterAll(async () => {
      if (context) await resetFiscalE2eData(context);
      await prisma?.$disconnect();
      await app?.close();
    });

    it('runs the full commercial chain, signed local FE, total NC, replacement and blocked ND preparation', async () => {
      const root = process.env.AFILIACIONES_W5_ROOT;
      if (!root) throw new Error('AFILIACIONES_W5_ROOT is required');
      app.get(W2B2LabInvoiceService).interruptOnceAfterDocument();
      const child = await execute(process.execPath, [join(root, 'scripts/w5-cross-system.mjs')], {
        cwd: root,
        timeout: 120000,
        windowsHide: true,
        env: {
          ...process.env,
          PRISMA_QUERY_ENGINE_LIBRARY: join(
            root,
            'node_modules/@prisma/engines/query_engine-windows.dll.node',
          ),
          W5_BILLING_LAB_URL: `${billingBase}/`,
          W5_BILLING_COMPANY_ID: companyId,
          W5_BILLING_API_KEY: key,
        },
      });
      const matched = child.stdout.match(/W5_CROSS_SYSTEM_RESULT (\{[^\n]+\})/);
      if (!matched)
        throw new Error(`Afiliaciones E2E did not report success: ${child.stderr || child.stdout}`);
      const result = JSON.parse(matched[1]) as {
        documentId: string;
        partialDocumentId: string;
        creditSourceDocumentId: string;
        allocations: number;
        periods: number;
        partialBalance: string;
        billingStatus: string;
        recoveryAttempts: number;
        rejectionCode: string;
      };
      expect(result.recoveryAttempts).toBeGreaterThanOrEqual(2);
      expect(result.rejectionCode).toBe('W2B_TAX_AMOUNT_MISMATCH');
      expect(result.allocations).toBe(3);
      expect(result.periods).toBe(2);
      expect(result.partialBalance).toBe('113.00');
      expect(result.billingStatus).toBe('READY_TO_SUBMIT');
      const original = await prisma.fiscalDocument.findUniqueOrThrow({
        where: { id: result.documentId },
        include: { xmlArtifacts: true },
      });
      expect(original.status).toBe('READY_TO_SUBMIT');
      expect(original.xmlArtifacts[0].xsdValidationStatus).toBe('VALID');
      const invoiceXml = await fetch(
        `${billingBase}/api/v2/lab/companies/${companyId}/fiscal-documents/SANDBOX/invoices/${result.documentId}/signed-xml`,
        { headers: { 'X-API-Key': key } },
      );
      expect(invoiceXml.status).toBe(200);
      const invoiceBytes = Buffer.from(await invoiceXml.arrayBuffer());
      const storedInvoiceBytes = await app
        .get<StoragePort>(STORAGE_PORT)
        .download(original.xmlArtifacts[0].signedXmlStorageKey ?? '');
      expect(invoiceBytes.equals(storedInvoiceBytes)).toBe(true);
      expect(invoiceXml.headers.get('X-Content-SHA256')).toBe(
        createHash('sha256').update(invoiceBytes).digest('hex'),
      );
      expect(invoiceXml.headers.get('Cache-Control')).toBe('no-store');
      await prisma.fiscalDocument.update({
        where: { id: original.id },
        data: { status: 'ACCEPTED' },
      });
      const workflow = (await adapter('cancel', {
        sourceDocumentId: original.id,
        reason: 'Anulación sintética W5',
        key: 'w5-cancel',
      })) as { workflowId: string; cancellationNoteId: string };
      const xml = await adapter('xml', { documentId: workflow.cancellationNoteId });
      expect(xml.isCreditNote).toBe(true);
      expect(xml.length).toBeGreaterThan(100);
      await prisma.fiscalDocument.update({
        where: { id: workflow.cancellationNoteId },
        data: { status: 'ACCEPTED' },
      });
      const drafted = await adapter('draft', {
        workflowId: workflow.workflowId,
        observation: 'Sustitución sintética',
        key: 'w5-draft',
      });
      expect(drafted.state).toBe('REPLACEMENT_DRAFT');
      const intent = drafted.draft as Record<string, unknown>;
      const confirmed = await adapter('confirm', {
        workflowId: workflow.workflowId,
        intent,
        key: 'w5-confirm',
      });
      expect(confirmed.state).toBe('REPLACEMENT_ISSUED');
      const replay = await adapter('confirm', {
        workflowId: workflow.workflowId,
        intent,
        key: 'w5-confirm',
      });
      expect(replay.replacementDocumentId).toBe(confirmed.replacementDocumentId);
      await prisma.fiscalDocument.update({
        where: { id: result.partialDocumentId },
        data: { status: 'ACCEPTED' },
      });
      const secondWorkflow = (await adapter('cancel', {
        sourceDocumentId: result.partialDocumentId,
        reason: 'Anulación parcial sintética W5',
        key: 'w5-partial-cancel',
      })) as { workflowId: string; cancellationNoteId: string };
      await prisma.fiscalDocument.update({
        where: { id: secondWorkflow.cancellationNoteId },
        data: { status: 'ACCEPTED' },
      });
      const reversal = await adapter('reversal', {
        workflowId: secondWorkflow.workflowId,
        key: 'w5-reversal',
      });
      expect(reversal.state).toBe('BLOCKED_FISCAL_POLICY');
      expect(reversal.reversalNoteId).toBeNull();
      await prisma.fiscalDocument.update({
        where: { id: result.creditSourceDocumentId },
        data: { status: 'ACCEPTED' },
      });
      const credit = await adapter('credit', {
        sourceDocumentId: result.creditSourceDocumentId,
        reason: 'Anulación exenta sintética',
        externalCorrectionId: randomUUID(),
        key: 'w5-credit',
      });
      expect(credit.documentStatus).toBe('XML_VALIDATED');
      const directXml = await adapter('xml', { documentId: credit.documentId });
      expect(directXml.isCreditNote).toBe(true);
    });
  },
);
