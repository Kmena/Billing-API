/**
 * STEP 2: Authorize Inventori M2M API key for the target Billing Company.
 *
 * Evidence chain:
 *   createDocument() (fiscal-document.service.ts:238) checks:
 *     if (apiKeyId) {
 *       const authorization = await tx.apiKeyCompany.findUnique(...)
 *       if (!authorization) throw ForbiddenException('API_KEY_COMPANY_NOT_AUTHORIZED')
 *     }
 *   getDocument() (fiscal-document.service.ts:211) same pattern.
 *   All submission services: assertApiKeyCompany() same pattern.
 *
 *   => ApiKeyCompany binding IS required for all M2M invoice operations.
 *   => No HTTP endpoint exists for this management operation.
 *   => Repository convention: direct Prisma (test/helpers/fiscal-e2e-helpers.ts:138,
 *      test/hacienda-sandbox/scenarios/task-009-fe-submission.ts:475,
 *      f3-postgres-concurrency.spec.ts:41).
 *
 * SAFETY:
 *   - Idempotent: upsert semantics (create only if missing).
 *   - Binds ONLY the exact Inventori M2M key to ONLY the exact target Company.
 *   - Does NOT modify any ApiKey data.
 *   - Does NOT create FiscalDocuments or touch any fiscal data.
 *   - Does NOT call Hacienda.
 */

import { readFileSync } from 'fs';
import { PrismaClient } from '@prisma/client';

// ── Load env ────────────────────────────────────────────────────────────────
const envContent = readFileSync('.env.local', 'utf8');
for (const line of envContent.split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i < 0) continue;
  const k = t.slice(0, i).trim();
  const v = t.slice(i + 1).trim();
  if (k && !process.env[k]) process.env[k] = v;
}

const TENANT_ID  = process.env.INVENTORI_SANDBOX_TENANT_ID;
const COMPANY_ID = process.env.INVENTORI_SANDBOX_COMPANY_ID;
const KEY_PREFIX = '8c3323eb'; // Inventori SANDBOX M2M key prefix

const prisma = new PrismaClient();

async function main() {
  // ── 1. Resolve key ID from prefix ────────────────────────────────────────
  const apiKey = await prisma.apiKey.findFirst({
    where: { keyPrefix: KEY_PREFIX, status: 'ACTIVE', tenantId: TENANT_ID },
    select: { id: true, name: true, scopes: true, status: true, tenantId: true },
  });
  if (!apiKey) throw new Error(`Active API key with prefix ${KEY_PREFIX} not found under tenant ${TENANT_ID}`);

  console.log(`\n=== API KEY ===`);
  console.log(`  id:      ${apiKey.id}`);
  console.log(`  prefix:  ${KEY_PREFIX}`);
  console.log(`  status:  ${apiKey.status}`);
  console.log(`  tenant:  ${apiKey.tenantId}`);
  console.log(`  scopes:  ${JSON.stringify(apiKey.scopes)}`);

  // ── 2. Verify target company belongs to correct tenant ─────────────────
  const company = await prisma.company.findFirst({
    where: { id: COMPANY_ID, tenantId: TENANT_ID, status: 'ACTIVE' },
    select: { id: true, identificationNumber: true, identificationType: true, status: true },
  });
  if (!company) throw new Error(`Company ${COMPANY_ID} not found under tenant ${TENANT_ID}`);
  console.log(`\n=== TARGET COMPANY ===`);
  console.log(`  id:     ${company.id}`);
  console.log(`  type:   ${company.identificationType}`);
  console.log(`  number: ${company.identificationNumber}`);
  console.log(`  status: ${company.status}`);

  // ── 3. Check current binding state ───────────────────────────────────────
  const existing = await prisma.apiKeyCompany.findUnique({
    where: { apiKeyId_companyId: { apiKeyId: apiKey.id, companyId: COMPANY_ID } },
  });
  if (existing) {
    console.log(`\n[OK] ApiKeyCompany binding already exists — no action needed.`);
    console.log(`     apiKeyId:  ${apiKey.id}`);
    console.log(`     companyId: ${COMPANY_ID}`);
    return { created: false, apiKeyId: apiKey.id, companyId: COMPANY_ID };
  }

  // ── 4. Check current companies list ──────────────────────────────────────
  const currentBindings = await prisma.apiKeyCompany.findMany({
    where: { apiKeyId: apiKey.id },
    select: { companyId: true },
  });
  console.log(`\n[INFO] Current ApiKeyCompany bindings: ${currentBindings.length}`);
  for (const b of currentBindings) console.log(`  companyId: ${b.companyId}`);

  // ── 5. Create the binding ─────────────────────────────────────────────────
  // Repository convention: direct Prisma insert.
  // No HTTP endpoint exists for ApiKeyCompany management.
  // Consistent with: test/helpers/fiscal-e2e-helpers.ts:138
  //                  test/hacienda-sandbox/scenarios/task-009-fe-submission.ts:475
  //                  f3-postgres-concurrency.spec.ts:41
  await prisma.apiKeyCompany.create({
    data: { apiKeyId: apiKey.id, companyId: COMPANY_ID },
  });
  console.log(`\n[OK] ApiKeyCompany binding CREATED.`);
  console.log(`     apiKeyId:  ${apiKey.id}`);
  console.log(`     companyId: ${COMPANY_ID}`);

  // ── 6. Verify post-creation state ────────────────────────────────────────
  const verify = await prisma.apiKeyCompany.findUnique({
    where: { apiKeyId_companyId: { apiKeyId: apiKey.id, companyId: COMPANY_ID } },
  });
  if (!verify) throw new Error('Binding verification failed after creation!');
  console.log(`\n[OK] Binding verified in DB.`);

  const allBindings = await prisma.apiKeyCompany.findMany({
    where: { apiKeyId: apiKey.id },
    select: { companyId: true },
  });
  console.log(`\n[INFO] Final ApiKeyCompany bindings: ${allBindings.length}`);
  for (const b of allBindings) console.log(`  companyId: ${b.companyId}`);

  return { created: true, apiKeyId: apiKey.id, companyId: COMPANY_ID };
}

main()
  .then(r => {
    console.log('\n=== RESULT ===');
    console.log(`  binding action: ${r.created ? 'CREATED' : 'ALREADY_EXISTS'}`);
    console.log(`  apiKeyId:       ${r.apiKeyId}`);
    console.log(`  companyId:      ${r.companyId}`);
  })
  .catch(e => { console.error('[ERROR]', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
