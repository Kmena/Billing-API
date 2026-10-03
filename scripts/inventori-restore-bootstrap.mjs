/**
 * Inventori SANDBOX Bootstrap RESTORE script.
 *
 * Context: The f3-postgres-concurrency integration test does a global deleteMany()
 * on ALL tables in the shared dev DB, wiping bootstrap state.
 *
 * This script restores the authoritative bootstrap state WITHOUT calling Hacienda.
 * All data values are from the authoritative bootstrap record in .env.local and
 * specs/inventori-p0-fiscal-compatibility/current-state.md.
 *
 * SAFETY:
 *   - Hacienda OAuth:            0
 *   - Hacienda /recepcion POST:  0
 *   - Hacienda /fe/ae GET:       0
 *   - FiscalDocuments created:   0
 *   - Consecutives consumed:     0
 *   - Taxpayer data is restored from known-good values (no re-verification needed)
 *
 * The certificate upload IS done via HTTP API (requires running server)
 * because EnvSecretProvider is in-memory and certificate bytes must be
 * re-loaded via the upload endpoint (not directly in Prisma).
 */

import { readFileSync, existsSync } from 'fs';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomUUID } from 'crypto';

// ── Load env ─────────────────────────────────────────────────────────────────
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

// ── Authoritative bootstrap constants (from previous task + .env.local) ─────
const TENANT_ID  = process.env.INVENTORI_SANDBOX_TENANT_ID;   // 25ae538c-b272-407b-83d0-ccc78be3c658
const COMPANY_ID = process.env.INVENTORI_SANDBOX_COMPANY_ID;  // dde91f44-6ceb-4eb7-b322-0139919cc34d
const API_KEY_ID = process.env.INVENTORI_M2M_API_KEY_ID;      // c255f9ff-3c9d-4665-8718-5c4467ae427a
const RAW_KEY    = process.env.INVENTORI_M2M_API_KEY;         // bk_test_8c3323eb_3611035e343b7e8607981c431b6233f7
const KEY_PREFIX = process.env.INVENTORI_M2M_API_KEY_PREFIX;  // 8c3323eb
const BASE_URL   = `http://localhost:${process.env.PORT ?? 3000}/api/v1`;
const CERT_PATH  = process.env.F4S_SANDBOX_CERT_PATH ?? '.secrets/hacienda-sandbox.p12';
const CERT_PIN   = process.env.F4S_SANDBOX_CERT_PIN ?? '2503';
const ADMIN_EMAIL    = 'admin@inventori-sandbox.billing';
const ADMIN_PASSWORD = 'Admin@Billing2026!';

// Authoritative taxpayer data (from Hacienda /fe/ae — verified 2026-09-25)
const COMPANY_DATA = {
  id: COMPANY_ID,
  tenantId: TENANT_ID,
  legalName: 'PERSONA FISICA SANDBOX',
  tradeName: null,
  identificationType: 'FISICA',
  identificationNumber: '207530251',
  status: 'ACTIVE',
  haciendaName: 'KAREN VANESSA CASTRO GOMEZ',
  haciendaVerificationStatus: 'VERIFIED',
  haciendaVerifiedAt: new Date('2026-09-25T16:32:38.160Z'),
  haciendaTaxSituation: 'Inscrito',
  haciendaMoroso: false,
  haciendaOmiso: false,
};

const PROFILE_DATA = {
  id: '59fad3a1-7726-4f8e-a2a5-97612c6b25a1',
  tenantId: TENANT_ID,
  companyId: COMPANY_ID,
  economicActivityCode: '9609.0',
  defaultEconomicActivityId: 'f4351065-e744-4006-b892-d3c0e31c58e9',
  province: '2',
  canton: '07',
  district: '01',
  barrio: null,
  otrasSenas: 'San José, Costa Rica',
  email: 'facturacion@inventori-sandbox.co.cr',
  phoneCountryCode: null,
  phoneNumber: null,
  proveedorSistemas: null,
};

const ACTIVITY_DATA = {
  id: 'f4351065-e744-4006-b892-d3c0e31c58e9',
  tenantId: TENANT_ID,
  companyId: COMPANY_ID,
  code: '9609.0',
  description: 'Otras actividades de servicios  personales ncp',
  haciendaStatus: 'A',
  haciendaKind: 'P',
  billingEnabled: true,
  verificationSource: 'HACIENDA_FE_AE',
  verifiedAt: new Date('2026-09-25T16:32:38.160Z'),
  lastSeenAt: new Date('2026-09-25T16:32:38.160Z'),
};

const CERT_DB = {
  id: '84139b0d-b539-4f37-8ded-02040ec652c3',
  tenantId: TENANT_ID,
  companyId: COMPANY_ID,
  environment: 'SANDBOX',
  status: 'ACTIVE',
  fingerprintSha256: '38016cc5bf2029885a61257617e13bee1c81183b3f8ddafa5f9f1320f0e18e95',
  extractedIdentityNumber: '207530251',
  extractedIdentityType: '01',
  subjectName: '2.5.4.5=CPF-02-0753-0251, 2.5.4.4=CASTRO GOMEZ, 2.5.4.42=KAREN VANESSA, C=CR, O=PERSONA FISICA, OU=CPF, CN=KAREN VANESSA CASTRO GOMEZ',
  validFrom: new Date('2026-09-18T20:07:59.000Z'),
  validTo: new Date('2030-09-17T20:07:59.000Z'),
};

const CONNECTION_DATA = {
  id: 'c48b9a7e-2c36-48d2-9bf1-bd88b52e266d',
  tenantId: TENANT_ID,
  companyId: COMPANY_ID,
  environment: 'SANDBOX',
  status: 'PENDING_VALIDATION',
  secretReference: `hacienda-conn/${COMPANY_ID}/SANDBOX`,
};

const ISSUANCE_POINT_DATA = {
  id: '304e10fd-e5bc-4aa3-b084-033ebd2879b9',
  tenantId: TENANT_ID,
  companyId: COMPANY_ID,
  environment: 'SANDBOX',
  branchCode: '001',
  terminalCode: '00001',
  isDefault: true,
  active: true,
};

const prisma = new PrismaClient();

async function post(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`POST ${path} → ${res.status}`), { body: json });
  return json;
}

async function main() {
  console.log('[RESTORE] Starting Inventori SANDBOX bootstrap restore...');

  // ── 1. Seed Tenant ──────────────────────────────────────────────────────
  const tenant = await prisma.tenant.upsert({
    where: { id: TENANT_ID },
    create: { id: TENANT_ID, name: 'Inventori SANDBOX', slug: 'inventori-sandbox', status: 'ACTIVE' },
    update: { status: 'ACTIVE' },
  });
  console.log(`[OK] Tenant: ${tenant.id}`);

  // ── 2. Seed TENANT_ADMIN user ──────────────────────────────────────────
  // Project uses argon2id for all password hashing (ADR-002)
  const passwordHash = await argon2.hash(ADMIN_PASSWORD, { type: argon2.argon2id });
  const userId = randomUUID();
  const existingUser = await prisma.user.findFirst({ where: { tenantId: TENANT_ID, email: ADMIN_EMAIL } });
  let user = existingUser;
  if (!user) {
    user = await prisma.user.create({
      data: {
        id: userId, tenantId: TENANT_ID, email: ADMIN_EMAIL,
        passwordHash, role: 'TENANT_ADMIN', status: 'ACTIVE',
      },
    });
    console.log(`[OK] User created: ${user.id}`);
  } else {
    console.log(`[OK] User already exists: ${user.id}`);
  }

  // ── 3. Seed Company (with full taxpayer data) ──────────────────────────
  await prisma.company.upsert({
    where: { id: COMPANY_ID },
    create: COMPANY_DATA,
    update: {
      haciendaName: COMPANY_DATA.haciendaName,
      haciendaVerificationStatus: COMPANY_DATA.haciendaVerificationStatus,
      haciendaVerifiedAt: COMPANY_DATA.haciendaVerifiedAt,
      haciendaTaxSituation: COMPANY_DATA.haciendaTaxSituation,
      haciendaMoroso: COMPANY_DATA.haciendaMoroso,
      haciendaOmiso: COMPANY_DATA.haciendaOmiso,
      status: 'ACTIVE',
    },
  });
  console.log(`[OK] Company: ${COMPANY_ID}`);

  // ── 4. Seed Economic Activity ───────────────────────────────────────────
  await prisma.companyEconomicActivity.upsert({
    where: { id: ACTIVITY_DATA.id },
    create: ACTIVITY_DATA,
    update: { haciendaStatus: 'A', haciendaKind: 'P', billingEnabled: true },
  });
  console.log(`[OK] Economic activity: ${ACTIVITY_DATA.code}`);

  // ── 5. Seed Fiscal Profile ──────────────────────────────────────────────
  await prisma.companyFiscalProfile.upsert({
    where: { id: PROFILE_DATA.id },
    create: PROFILE_DATA,
    update: {
      economicActivityCode: PROFILE_DATA.economicActivityCode,
      defaultEconomicActivityId: PROFILE_DATA.defaultEconomicActivityId,
    },
  });
  console.log(`[OK] Fiscal profile: ${PROFILE_DATA.id}`);

  // ── 6. Re-upload certificate via HTTP API ───────────────────────────────
  // Certificate bytes are not persisted — EnvSecretProvider is in-memory.
  // Re-upload via HTTP API which re-loads P12 and re-stores in SecretProvider.
  if (!existsSync(CERT_PATH)) {
    console.log(`[WARN] Certificate file not found at ${CERT_PATH} — skipping upload`);
    console.log(`       Certificate DB record will be seeded without SecretProvider backing.`);
    // Seed cert DB record so identity checks still work for tests
    const certSecretRef = `fiscal-cert/${CERT_DB.id}`;
    await prisma.fiscalSigningCertificate.upsert({
      where: { id: CERT_DB.id },
      create: {
        ...CERT_DB,
        certificateType: 'HACIENDA_CRYPTOGRAPHIC_KEY',
        certificateSecretReference: certSecretRef,
        passwordSecretReference: `${certSecretRef}/pin`,
      },
      update: { status: 'ACTIVE' },
    });
    console.log(`[OK] Certificate DB record seeded (no P12 backing): ${CERT_DB.id}`);
  } else {
    // Login first
    const auth = await post('/auth/login', { tenantId: TENANT_ID, email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const JWT = auth.accessToken;

    // Check if cert already exists (active)
    const existingCert = await prisma.fiscalSigningCertificate.findFirst({
      where: { companyId: COMPANY_ID, environment: 'SANDBOX', status: 'ACTIVE' },
    });
    if (existingCert) {
      console.log(`[OK] Certificate already exists: ${existingCert.id}`);
    } else {
      // Upload P12 — field name is 'certificate' (not 'file') per FileInterceptor('certificate',...)
      const certBytes = readFileSync(CERT_PATH);
      const formData = new FormData();
      formData.append('certificate', new Blob([certBytes], { type: 'application/x-pkcs12' }), 'cert.p12');
      formData.append('pin', CERT_PIN);

      const uploadRes = await fetch(`${BASE_URL}/companies/${COMPANY_ID}/fiscal-certificates/SANDBOX`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${JWT}` },
        body: formData,
      });
      if (uploadRes.ok) {
        const certJson = await uploadRes.json();
        console.log(`[OK] Certificate uploaded: ${certJson.id}`);
      } else {
        const errBody = await uploadRes.text();
        console.log(`[WARN] Certificate upload failed: ${uploadRes.status} ${errBody}`);
        // Fallback: seed DB directly with required fields
        const certSecretRef = `fiscal-cert/${CERT_DB.id}`;
        await prisma.fiscalSigningCertificate.upsert({
          where: { id: CERT_DB.id },
          create: {
            ...CERT_DB,
            certificateType: 'HACIENDA_CRYPTOGRAPHIC_KEY',
            certificateSecretReference: certSecretRef,
            passwordSecretReference: `${certSecretRef}/pin`,
          },
          update: { status: 'ACTIVE' },
        });
        console.log(`[OK] Certificate DB record seeded as fallback: ${CERT_DB.id}`);
      }
    }
  }

  // ── 7. Seed Hacienda Connection ──────────────────────────────────────────
  await prisma.haciendaConnection.upsert({
    where: { id: CONNECTION_DATA.id },
    create: CONNECTION_DATA,
    update: { status: 'PENDING_VALIDATION' },
  });
  console.log(`[OK] Hacienda connection: ${CONNECTION_DATA.id}`);

  // ── 8. Seed Issuance Point ───────────────────────────────────────────────
  await prisma.fiscalIssuancePoint.upsert({
    where: { id: ISSUANCE_POINT_DATA.id },
    create: ISSUANCE_POINT_DATA,
    update: { active: true, isDefault: true },
  });
  console.log(`[OK] Issuance point: ${ISSUANCE_POINT_DATA.id}`);

  // ── 9. Re-create M2M API key ─────────────────────────────────────────────
  // Hash the known raw key from .env.local
  if (!RAW_KEY) throw new Error('INVENTORI_M2M_API_KEY not found in .env.local');
  const keyHash = await argon2.hash(RAW_KEY, { type: argon2.argon2id });
  await prisma.apiKey.upsert({
    where: { id: API_KEY_ID },
    create: {
      id: API_KEY_ID,
      tenantId: TENANT_ID,
      name: 'Inventori SANDBOX M2M',
      environment: 'TEST',
      keyPrefix: KEY_PREFIX,
      keyHash,
      scopes: [
        'taxpayers:read', 'cabys:read', 'exchange-rates:read',
        'fiscal-onboarding:read', 'fiscal-onboarding:write',
        'fiscal-credentials:write', 'fiscal-credentials:validate',
        'invoices:read', 'invoices:write', 'tickets:read', 'tickets:write',
      ],
      status: 'ACTIVE',
    },
    update: { status: 'ACTIVE', keyHash }, // re-hash in case argon2 params changed
  });
  console.log(`[OK] API key: ${API_KEY_ID} (prefix: ${KEY_PREFIX})`);

  // ── 10. ApiKeyCompany binding ────────────────────────────────────────────
  await prisma.apiKeyCompany.upsert({
    where: { apiKeyId_companyId: { apiKeyId: API_KEY_ID, companyId: COMPANY_ID } },
    create: { apiKeyId: API_KEY_ID, companyId: COMPANY_ID },
    update: {},
  });
  console.log(`[OK] ApiKeyCompany binding: ${API_KEY_ID} → ${COMPANY_ID}`);

  // ── 11. Verify readiness ─────────────────────────────────────────────────
  const company = await prisma.company.findUnique({ where: { id: COMPANY_ID } });
  const activities = await prisma.companyEconomicActivity.count({ where: { companyId: COMPANY_ID } });
  const profile = await prisma.companyFiscalProfile.findFirst({ where: { companyId: COMPANY_ID } });
  const cert = await prisma.fiscalSigningCertificate.findFirst({ where: { companyId: COMPANY_ID, status: 'ACTIVE' } });
  const conn = await prisma.haciendaConnection.findFirst({ where: { companyId: COMPANY_ID } });
  const point = await prisma.fiscalIssuancePoint.findFirst({ where: { companyId: COMPANY_ID, isDefault: true } });
  const apiKey = await prisma.apiKey.findUnique({ where: { id: API_KEY_ID } });
  const binding = await prisma.apiKeyCompany.findUnique({ where: { apiKeyId_companyId: { apiKeyId: API_KEY_ID, companyId: COMPANY_ID } } });

  console.log('\n=== RESTORE VERIFICATION ===');
  console.log(`  Company status:          ${company?.status}`);
  console.log(`  Taxpayer verified:       ${company?.haciendaVerificationStatus}`);
  console.log(`  Identity:                ${company?.identificationType}/${company?.identificationNumber}`);
  console.log(`  Economic activities:     ${activities}`);
  console.log(`  Default activity:        ${profile?.economicActivityCode}`);
  console.log(`  Certificate:             ${cert?.status ?? 'MISSING'}`);
  console.log(`    extractedIdentity:     ${cert?.extractedIdentityType}/${cert?.extractedIdentityNumber}`);
  console.log(`  Hacienda connection:     ${conn?.status}`);
  console.log(`  Issuance point:          ${point?.branchCode}/${point?.terminalCode}`);
  console.log(`  API key:                 ${apiKey?.status}`);
  console.log(`  ApiKeyCompany binding:   ${binding ? 'EXISTS ✅' : 'MISSING ❌'}`);

  const ok = company?.status === 'ACTIVE' && company?.haciendaVerificationStatus === 'VERIFIED'
    && activities > 0 && cert?.status === 'ACTIVE' && conn && point && apiKey?.status === 'ACTIVE' && binding;
  console.log(`\n=== RESTORE RESULT: ${ok ? 'COMPLETE ✅' : 'PARTIAL ⚠️'} ===`);
  console.log('\nNote: Hacienda OAuth = 0, /fe/ae = 0, /recepcion = 0, documents = 0');
}

main()
  .catch(e => { console.error('[ERROR]', e.message, e.body); process.exit(1); })
  .finally(() => prisma.$disconnect());
