'use strict';

// Run only inside the installed SPEC-09 Billing container, fed through stdin.
// The caller must be the authorized local Docker operator. No key leaves this process.
const fs = require('node:fs');
const https = require('node:https');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('/app/node_modules/@prisma/client');
const {
  CreateApiKeyHandler,
} = require('/app/dist/src/modules/api-keys/application/use-cases/create-api-key/create-api-key.handler');
const {
  AssignApiKeyCompanyHandler,
} = require('/app/dist/src/modules/api-keys/application/use-cases/assign-api-key-company/assign-api-key-company.handler');
const {
  PrismaApiKeyRepository,
} = require('/app/dist/src/modules/api-keys/infrastructure/persistence/prisma-api-key.repository');
const {
  resolveDeliveryRecipient,
} = require('/app/dist/src/modules/fiscal-documents/application/delivery/delivery-recipient.resolver');

const documentId = '817f1bd8-0092-4661-9064-e7f69d18b5b6';
const clave = '50606112600020753025100100001010000000008156925025';
const consecutive = '00100001010000000008';
const recipient = 'kmena281@gmail.com';
const expectedHashes = new Map([
  ['PDF', '729bad376e88897a3364e38a829374686290a6d5d0cb8b3e78a1f67cdfe28317'],
  ['SIGNED_XML', 'e5eaac5796ed75ecc6c018d5462e11048903c32ea8a4c5f14e2f24562205da4f'],
  ['HACIENDA_RESPONSE_XML', 'dc26b7e28ec3d75d95bd105cce2a48f99c1943d5a236e91f315a27ea8015936f'],
]);
const dryRun = process.env.SPEC10_EMAIL_DRY_RUN === 'true';

function fail(code) {
  throw new Error(code);
}
function assertFlags() {
  if (
    process.env.NODE_ENV !== 'test' ||
    process.env.USE_REAL_HACIENDA !== 'false' ||
    process.env.BILLING_SPEC09_STAG_INVOICING !== 'false' ||
    process.env.HACIENDA_RECEPCION_PRODUCTION_BASE_URL !== 'https://127.0.0.1:9/' ||
    process.env.FISCAL_DELIVERY_RECOVERY_ENABLED !== 'false' ||
    process.env.FISCAL_DELIVERY_STARTUP_RECOVERY_ENABLED !== 'false' ||
    process.env.EMAIL_USE_REAL !== (dryRun ? 'false' : 'true')
  ) {
    fail('SPEC10_EMAIL_FLAGS_UNSAFE');
  }
  if (!dryRun && process.env.SPEC10_SINGLE_EMAIL !== 'true') {
    fail('SPEC10_EMAIL_WINDOW_NOT_EXCLUSIVE');
  }
  if (!dryRun && process.env.SPEC10_LOCAL_DELIVERY_AUTHORIZATION !== `SEND_${documentId}`) {
    fail('SPEC10_EMAIL_OPERATOR_AUTHORIZATION_MISSING');
  }
}
async function preflight(prisma) {
  const doc = await prisma.fiscalDocument.findUnique({
    where: { id: documentId },
    include: { submission: true, fiscalArtifacts: true },
  });
  if (
    !doc ||
    doc.environment !== 'SANDBOX' ||
    doc.type !== 'INVOICE' ||
    doc.status !== 'ACCEPTED' ||
    doc.clave !== clave ||
    doc.consecutive !== consecutive ||
    doc.submission?.status !== 'ACCEPTED' ||
    doc.submission.attemptCount !== 1 ||
    doc.submission.reconciliationAttemptCount !== 1 ||
    doc.submission.signedXmlSha256 !== expectedHashes.get('SIGNED_XML') ||
    doc.submission.responseSha256 !== expectedHashes.get('HACIENDA_RESPONSE_XML')
  ) {
    fail('SPEC10_EMAIL_DOCUMENT_GUARD_FAILED');
  }
  const resolved = resolveDeliveryRecipient(doc.receiverSnapshot);
  if (resolved.kind !== 'RESOLVED' || resolved.recipient !== recipient) {
    fail('SPEC10_EMAIL_RECIPIENT_GUARD_FAILED');
  }
  for (const [type, sha256] of expectedHashes) {
    const matches = doc.fiscalArtifacts.filter(
      (item) =>
        item.type === type &&
        item.sha256 === sha256 &&
        item.supersededAt === null &&
        item.sizeBytes > 100,
    );
    if (matches.length !== 1) fail('SPEC10_EMAIL_ARTIFACT_GUARD_FAILED');
  }
  const existing = await prisma.documentDelivery.findMany({
    where: { fiscalDocumentId: documentId, kind: 'ACCEPTED_FISCAL_PACKAGE' },
    select: { id: true },
  });
  if (existing.length !== 0) fail('SPEC10_EMAIL_DUPLICATE_DELIVERY_GUARD');
  const company = await prisma.company.findFirst({
    where: { id: doc.companyId, tenantId: doc.tenantId, status: 'ACTIVE' },
    select: { id: true },
  });
  if (!company) fail('SPEC10_EMAIL_COMPANY_GUARD_FAILED');
  const pendingJobs = await prisma.$queryRawUnsafe(
    "SELECT count(*)::int AS count FROM pgboss.job WHERE state IN ('created','retry','active')",
  );
  if (pendingJobs.length !== 1 || pendingJobs[0].count !== 0) {
    fail('SPEC10_EMAIL_CONCURRENT_JOB_GUARD_FAILED');
  }
  return { tenantId: doc.tenantId, companyId: doc.companyId };
}
function requestOnce(companyId, key) {
  return new Promise((resolve, reject) => {
    const path = `/api/v1/companies/${companyId}/fiscal-documents/SANDBOX/invoices/${documentId}/accepted-package-resend`;
    const req = https.request(
      {
        hostname: 'billing-spec09-sandbox',
        port: 3443,
        path,
        method: 'POST',
        ca: fs.readFileSync('/run/spec09-tls/ca.crt'),
        rejectUnauthorized: true,
        headers: { 'X-API-Key': key, 'Content-Length': '0' },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
          if (body.length > 16_384) res.destroy(new Error('BODY_LIMIT'));
        });
        res.on('end', () => {
          if (res.statusCode !== 202)
            return reject(new Error(`SPEC10_EMAIL_REQUEST_HTTP_${res.statusCode}`));
          let payload;
          try {
            payload = JSON.parse(body);
          } catch {
            return reject(new Error('SPEC10_EMAIL_RESPONSE_INVALID'));
          }
          if (!/^[0-9a-f-]{36}$/i.test(payload.deliveryId ?? '')) {
            return reject(new Error('SPEC10_EMAIL_RESPONSE_INVALID'));
          }
          resolve(payload.deliveryId);
        });
      },
    );
    req.setTimeout(15_000, () => req.destroy(new Error('SPEC10_EMAIL_REQUEST_AMBIGUOUS')));
    req.on('error', () => reject(new Error('SPEC10_EMAIL_REQUEST_AMBIGUOUS')));
    req.end();
  });
}
async function waitForDelivery(prisma, deliveryId) {
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    const row = await prisma.documentDelivery.findUnique({
      where: { id: deliveryId },
      select: { id: true, status: true, attemptCount: true, providerMessageId: true },
    });
    if (!row) fail('SPEC10_EMAIL_DELIVERY_ROW_MISSING');
    if (row.status === 'DELIVERED') {
      if (row.attemptCount !== 1 || !row.providerMessageId)
        fail('SPEC10_EMAIL_ATTEMPT_OR_MESSAGE_INVALID');
      return row;
    }
    if (['FAILED', 'MANUAL_REVIEW_REQUIRED', 'CANCELLED'].includes(row.status)) {
      fail(`SPEC10_EMAIL_DELIVERY_${row.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  fail('SPEC10_EMAIL_DELIVERY_UNCONFIRMED');
}

async function main() {
  assertFlags();
  const prisma = new PrismaClient();
  let key;
  let deliveryId;
  let result;
  try {
    await prisma.$connect();
    const target = await preflight(prisma);
    if (dryRun) {
      console.log('SPEC10_EMAIL_PREFLIGHT_PASS');
      return;
    }
    const name = `SPEC10 one-time package ${documentId}`;
    if (await prisma.apiKey.count({ where: { name, status: 'ACTIVE' } })) {
      fail('SPEC10_EMAIL_TEMP_KEY_ALREADY_ACTIVE');
    }
    key = await new CreateApiKeyHandler(new PrismaApiKeyRepository(prisma)).execute({
      tenantId: target.tenantId,
      name,
      environment: 'TEST',
      scopes: ['fiscal-deliveries:resend'],
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });
    const binding = await new AssignApiKeyCompanyHandler(prisma).execute({
      tenantId: target.tenantId,
      apiKeyId: key.id,
      companyId: target.companyId,
    });
    if (!binding.created) fail('SPEC10_EMAIL_TEMP_KEY_BINDING_FAILED');
    await prisma.auditLog.create({
      data: {
        id: randomUUID(),
        tenantId: target.tenantId,
        companyId: target.companyId,
        apiKeyId: key.id,
        actor: 'spec10-local-docker-operator',
        action: 'spec10.manual-delivery.temporary-key-issued',
        resource: `ApiKey:${key.id}`,
        correlationId: documentId,
        eventClass: 'SECURITY',
        metadata: {
          scope: 'fiscal-deliveries:resend',
          environment: 'SANDBOX',
          expiresInMinutes: 10,
        },
      },
    });
    deliveryId = await requestOnce(target.companyId, key.secret);
    key.secret = undefined;
    result = await waitForDelivery(prisma, deliveryId);
  } finally {
    let cleanupFailure;
    if (key?.id) {
      const revoked = await prisma.apiKey
        .updateMany({
          where: { id: key.id, status: 'ACTIVE' },
          data: { status: 'REVOKED', revokedAt: new Date() },
        })
        .catch(() => ({ count: 0 }));
      if (revoked.count !== 1) cleanupFailure = 'SPEC10_EMAIL_TEMP_KEY_REVOCATION_FAILED';
      else {
        const audited = await prisma.auditLog
          .create({
            data: {
              id: randomUUID(),
              tenantId: key.tenantId,
              apiKeyId: key.id,
              actor: 'spec10-local-docker-operator',
              action: 'spec10.manual-delivery.temporary-key-revoked',
              resource: `ApiKey:${key.id}`,
              correlationId: documentId,
              eventClass: 'SECURITY',
              metadata: { deliveryId: deliveryId ?? null },
            },
          })
          .then(() => true)
          .catch(() => false);
        if (!audited) cleanupFailure = 'SPEC10_EMAIL_REVOCATION_AUDIT_FAILED';
      }
    }
    await prisma.$disconnect();
    if (cleanupFailure) fail(cleanupFailure);
  }
  if (result)
    console.log(
      `SPEC10_REAL_EMAIL_DELIVERED delivery=${result.id} smtp_message_id=${result.providerMessageId} attempts=${result.attemptCount}`,
    );
}

main().catch((error) => {
  const code =
    typeof error?.message === 'string' && /^SPEC10_[A-Z0-9_]+$/.test(error.message)
      ? error.message
      : 'SPEC10_EMAIL_UNEXPECTED_FAILURE';
  console.error(code);
  process.exitCode = 1;
});
