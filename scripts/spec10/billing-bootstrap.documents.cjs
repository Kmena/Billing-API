// Explicitly opt into Billing's v2 lab module for the isolated SPEC-09 sandbox.
const { readFileSync } = require('node:fs');
const { createHash, hkdfSync } = require('node:crypto');
const { NestFactory } = require('@nestjs/core');
const { Module, ValidationPipe } = require('@nestjs/common');
const { AppModule } = require('/app/dist/src/app.module.js');
const { FiscalOnboardingAdminV2LabModule } = require('/app/dist/src/modules/fiscal-consumers/fiscal-onboarding-admin-v2-lab.module.js');
const { configureApiPrefixes } = require('/app/dist/src/bootstrap/api-prefix.js');
const { GlobalExceptionFilter } = require('/app/dist/src/api/filters/global-exception.filter.js');

async function main() {
  const stagInvoicing = process.env.BILLING_SPEC09_STAG_INVOICING === 'true';
  const singleEmail = process.env.SPEC10_SINGLE_EMAIL === 'true';
  const documentsRead = process.env.SPEC10_DOCUMENTS_READ === 'true';
  const oneEmailInvoiceId = '817f1bd8-0092-4661-9064-e7f69d18b5b6';
  const oneEmailKeyName = `SPEC10 one-time package ${oneEmailInvoiceId}`;
  let authorizedCompanyId;
  if (process.env.NODE_ENV !== 'test' ||
      process.env.USE_REAL_HACIENDA !== (stagInvoicing ? 'true' : 'false') ||
      process.env.FISCAL_WORKER_ENABLE_IN_TESTS !== (stagInvoicing || singleEmail ? 'true' : 'false') ||
      process.env.EMAIL_USE_REAL !== (singleEmail ? 'true' : 'false') ||
      (stagInvoicing && singleEmail) ||
      (documentsRead && (stagInvoicing || singleEmail)) ||
      (singleEmail && process.env.HACIENDA_RECEPCION_PRODUCTION_BASE_URL !== 'https://127.0.0.1:9/') ||
      process.env.SECRET_PROVIDER !== 'local-encrypted' ||
      process.env.BILLING_SPEC09_PERSISTENT_SANDBOX !== 'true' ||
      process.env.SPEC09_SANDBOX_MARKER !== 'billing-spec09-synthetic-v1') {
    throw new Error('SPEC09_SANDBOX_STARTUP_GUARD');
  }
  if (stagInvoicing && (process.env.HACIENDA_RECEPCION_SANDBOX_BASE_URL !==
      'https://api-sandbox.comprobanteselectronicos.go.cr/recepcion/v1' ||
      process.env.HACIENDA_IDP_SANDBOX_URL !==
      'https://idp.comprobanteselectronicos.go.cr/auth/realms/rut-stag/protocol/openid-connect/token' ||
      process.env.HACIENDA_RECEPCION_PRODUCTION_BASE_URL !== 'https://127.0.0.1:9/' ||
      process.env.HACIENDA_IDP_PRODUCTION_URL !== 'https://127.0.0.1:9/'))
    throw new Error('SPEC09_STAG_ENDPOINT_GUARD');
  const database = new URL(process.env.DATABASE_URL || '');
  if (database.protocol !== 'postgresql:' || database.hostname !== 'billing-spec09-db' ||
      database.port !== '5432' || database.pathname !== '/billing_sandbox' ||
      database.username !== 'billing_sandbox') throw new Error('SPEC09_SANDBOX_DATABASE_GUARD');
  const masterKey = readFileSync('/run/spec09-key/master.key');
  process.env.LOCAL_STORAGE_SECRET = createHash('sha256')
    .update(masterKey).update('spec09-fiscal-storage')
    .digest('hex');
  process.env.FISCAL_ONBOARDING_V2_HMAC_KEY = Buffer.from(hkdfSync('sha256', masterKey,
    'billing-spec09-sandbox-v1', 'fiscal-onboarding-v2-idempotency', 32)).toString('hex');
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient();
  try {
    const [tenants, companies, keys, documents, submissions, deliveries, associations, certificates, connections, mutations] = await Promise.all([
      db.tenant.findMany({ select: { slug: true } }),
      db.company.findMany({ select: { id: true, identificationNumber: true, identificationType: true, legalName: true } }),
      db.apiKey.findMany({ select: { environment: true, integrationProfile: true,
        name: true, status: true, scopes: true, companies: { select: { companyId: true } } } }),
      db.fiscalDocument.findMany({ select: { id: true, companyId: true, environment: true, type: true,
        originAssociationId: true } }),
      db.fiscalSubmission.findMany({ select: { fiscalDocumentId: true, status: true } }),
      db.documentDelivery.findMany({ select: { status: true } }),
      db.fiscalConsumerAssociation.findMany({ select: { id: true, status: true } }),
      db.fiscalSigningCertificate.findMany({ where: { status: 'ACTIVE' },
        select: { companyId: true, extractedIdentityNumber: true, extractedIdentityType: true } }),
      db.haciendaConnection.findMany({ select: { companyId: true } }),
      db.fiscalOnboardingMutationV2.findMany({ select: { state: true } }),
    ]);
    const company = companies[0];
    const expectedType = { FISICA: '01', JURIDICA: '02', DIMEX: '03', NITE: '04' }[company?.identificationType];
    const emptySyntheticIssuer = associations.length === 0 && mutations.length === 0 && certificates.length === 0 &&
      connections.length === 0 && company?.identificationNumber === '3101000001';
    const enrolledSyntheticIssuer = associations.length === 1 && associations[0].status === 'ACTIVE' &&
      certificates.length === 1 && certificates[0].companyId === company?.id &&
      certificates[0].extractedIdentityNumber === company?.identificationNumber &&
      certificates[0].extractedIdentityType === expectedType &&
      connections.length === 1 && connections[0].companyId === company?.id;
    const recoverableIssuer = company?.identificationNumber === '3101000001' &&
      associations.length === 1 && associations[0].status === 'SUSPENDED' &&
      certificates.length === 0 && connections.length === 0 &&
      mutations.length === 1 && ['STAGED', 'RECOVERY_REQUIRED', 'COMPENSATED'].includes(mutations[0].state);
    const terminalSubmissions = new Set(submissions
      .filter(submission => ['ACCEPTED', 'REJECTED', 'MANUAL_REVIEW_REQUIRED', 'SUPERSEDED'].includes(submission.status))
      .map(submission => submission.fiscalDocumentId));
    const safeToCloseStag = documents.every(document => terminalSubmissions.has(document.id)) &&
      deliveries.every(delivery => ['DELIVERED', 'FAILED', 'MANUAL_REVIEW_REQUIRED', 'CANCELLED'].includes(delivery.status));
    if (tenants.length !== 1 || tenants[0].slug !== 'spec09-sandbox-synthetic' ||
        companies.length !== 1 || company.legalName !== 'SPEC-09 EMISOR DEMO' ||
        keys.length < 1 || keys.some(key => {
          if (key.environment !== 'TEST') return true;
          if (key.integrationProfile === 'affiliations-enrollment-v2') return false;
          const boundToCompany = key.companies.length === 1 && key.companies[0].companyId === company.id;
          const temporary = key.name === oneEmailKeyName && key.integrationProfile === null &&
            key.scopes.length === 1 && key.scopes[0] === 'fiscal-deliveries:resend' &&
            ((key.status === 'REVOKED' && (boundToCompany || key.companies.length === 0)) ||
              (singleEmail && key.status === 'ACTIVE' && boundToCompany));
          return !temporary;
        }) ||
        documents.some(doc => doc.companyId !== company.id || doc.environment !== 'SANDBOX' ||
          doc.type !== 'INVOICE' || doc.originAssociationId !== associations[0]?.id) ||
        (!stagInvoicing && !safeToCloseStag) ||
        (!emptySyntheticIssuer && !enrolledSyntheticIssuer && !recoverableIssuer)) {
      throw new Error('SPEC09_SANDBOX_SYNTHETIC_DATA_GUARD');
    }
    authorizedCompanyId = company.id;
  } finally { await db.$disconnect(); }
  class SandboxModule {}
  const modules = [AppModule, FiscalOnboardingAdminV2LabModule];
  if (stagInvoicing || documentsRead) {
    const { W2B2FiscalLabModule } = require('/app/dist/src/modules/fiscal-intent-v2/w2-b2-fiscal-lab.module.js');
    modules.push(W2B2FiscalLabModule);
  }
  Module({ imports: modules })(SandboxModule);
  const app = await NestFactory.create(SandboxModule, {
    httpsOptions: {
      key: readFileSync('/run/spec09-tls/server.key'),
      cert: readFileSync('/run/spec09-tls/server.crt'),
    },
    bodyParser: true,
  });
  configureApiPrefixes(app);
  app.use((req, res, next) => {
    const path = req.path;
    if (path === '/health' || path === '/health/ready' || path === '/health/live' ||
        /^\/api\/v2\/companies\/[a-f\d-]{36}\/fiscal-onboarding\/SANDBOX(?:\/.*)?$/i.test(path) ||
        (stagInvoicing && /^\/api\/v2\/lab\/companies\/[a-f\d-]{36}\/fiscal-documents\/SANDBOX\/invoices(?:\/.*)?$/i.test(path)) ||
        (documentsRead && req.method === 'GET' &&
          /^\/api\/v2\/lab\/companies\/[a-f\d-]{36}\/fiscal-documents\/SANDBOX\/invoices\/[a-f\d-]{36}\/(?:fiscal-view|artifacts\/(?:PDF|SIGNED_XML|HACIENDA_RESPONSE_XML)|package)$/i.test(path)) ||
        (singleEmail && req.method === 'POST' && path ===
          `/api/v1/companies/${authorizedCompanyId}/fiscal-documents/SANDBOX/invoices/${oneEmailInvoiceId}/accepted-package-resend`)) return next();
    return res.status(404).json({ code: 'SANDBOX_ROUTE_DISABLED' });
  });
  app.useGlobalFilters(new GlobalExceptionFilter('test'));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableShutdownHooks();
  await app.listen(3443, '0.0.0.0');
}

main().catch((error) => {
  const code = error instanceof Error && /^SPEC09_[A-Z0-9_]+$/.test(error.message)
    ? error.message : 'STARTUP_ERROR';
  process.stderr.write(`SPEC09_SANDBOX_START_FAILED ${code}\n`);
  process.exitCode = 1;
});
