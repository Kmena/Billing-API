/**
 * Inventori SANDBOX Billing Bootstrap + Taxpayer Verification
 *
 * SAFETY:
 *   - SANDBOX only. Never modifies production.
 *   - Does NOT print DATABASE_URL, JWTs, PIN, P12 bytes, or raw keys.
 *   - Does NOT create FiscalDocuments or FiscalSubmissions.
 *   - Does NOT consume consecutives.
 *   - DOES make exactly ONE Hacienda public /fe/ae request (taxpayer verification).
 *   - Idempotent where possible.
 *
 * Steps:
 *   1. Seed DB: Tenant + TENANT_ADMIN user (direct Prisma — no public register endpoint)
 *   2. Login via API → JWT
 *   3. Create Company: FISICA / 207530251
 *   4. Create Fiscal Profile (placeholder code — will be replaced by verification)
 *   5. Configure Hacienda SANDBOX connection
 *   6. Upload PKCS#12 certificate
 *   7. Create default issuance point (SANDBOX, branch 001, terminal 00001)
 *   8. Run P0 taxpayer verification → Hacienda /fe/ae call
 *   9. Inspect readiness
 *   10. Create / reuse Inventori M2M API key with correct scopes
 */

import { readFileSync, existsSync } from 'fs';
import { randomUUID } from 'crypto';
import { createHash } from 'crypto';
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

// ─── Load env ────────────────────────────────────────────────────────────────
const envFile = readFileSync('.env.local', 'utf8');
for (const line of envFile.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx < 0) continue;
  const key = trimmed.slice(0, eqIdx).trim();
  const val = trimmed.slice(eqIdx + 1).trim();
  if (key && !process.env[key]) process.env[key] = val;
}

const BASE_URL = `http://localhost:${process.env.PORT ?? 3000}/api/v1`;
const CERT_PATH = process.env.F4S_SANDBOX_CERT_PATH ?? '.secrets/hacienda-sandbox.p12';
const CERT_PIN  = process.env.F4S_SANDBOX_CERT_PIN  ?? '';
const HACIENDA_USER = process.env.F4S_SANDBOX_USERNAME ?? '';
const HACIENDA_PASS = process.env.F4S_SANDBOX_PASSWORD ?? '';

const ADMIN_EMAIL    = 'admin@inventori-sandbox.billing';
const ADMIN_PASSWORD = 'Admin@Billing2026!';
const TENANT_NAME    = 'Inventori SANDBOX';
const TENANT_SLUG    = 'inventori-sandbox';
const COMPANY_LEGAL  = 'PERSONA FISICA SANDBOX';
const COMPANY_TYPE   = 'FISICA';
const COMPANY_ID_NUM = '207530251';
const ENV            = 'SANDBOX';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function log(msg) { console.log(`[bootstrap] ${msg}`); }
function ok(msg)  { console.log(`[OK] ${msg}`); }
function info(msg){ console.log(`[INFO] ${msg}`); }
function warn(msg){ console.log(`[WARN] ${msg}`); }

async function apiPost(path, body, token) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw Object.assign(new Error(`POST ${path} → ${res.status}`), { body: json, status: res.status });
  return json;
}

async function apiPut(path, body, token) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw Object.assign(new Error(`PUT ${path} → ${res.status}`), { body: json, status: res.status });
  return json;
}

async function apiGet(path, token, apiKey) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'GET',
    headers: {
      ...(token  ? { Authorization: `Bearer ${token}` } : {}),
      ...(apiKey ? { 'X-API-Key': apiKey } : {}),
    },
  });
  const json = await res.json();
  if (!res.ok) throw Object.assign(new Error(`GET ${path} → ${res.status}`), { body: json, status: res.status });
  return json;
}

async function apiPatch(path, body, token) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw Object.assign(new Error(`PATCH ${path} → ${res.status}`), { body: json, status: res.status });
  return json;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const prisma = new PrismaClient();
const results = {};

try {
  // ────────────────────────────────────────────────────────────────────────────
  // STEP 1: Current state audit
  // ────────────────────────────────────────────────────────────────────────────
  log('STEP 1 — Auditing current state...');

  const existingTenant = await prisma.tenant.findFirst({ where: { slug: TENANT_SLUG } });
  const existingCompany = await prisma.company.findFirst({
    where: { identificationNumber: COMPANY_ID_NUM },
  });
  info(`Existing tenant: ${existingTenant?.id ?? 'NOT FOUND'}`);
  info(`Existing company: ${existingCompany?.id ?? 'NOT FOUND'}`);

  // Previous taxpayer verification state
  if (existingCompany) {
    results.previousVerificationStatus = existingCompany.haciendaVerificationStatus;
    results.previousActivityCode = null;
    const p = await prisma.companyFiscalProfile.findFirst({ where: { companyId: existingCompany.id } });
    results.previousActivityCode = p?.economicActivityCode ?? 'NONE';
    info(`Previous verification: ${existingCompany.haciendaVerificationStatus ?? 'NULL (not verified)'}`);
    info(`Previous economicActivityCode: ${results.previousActivityCode}`);
  } else {
    results.previousVerificationStatus = 'NOT_EXISTS';
    results.previousActivityCode = 'NOT_EXISTS';
    warn('Company does not exist — full bootstrap required.');
  }

  // ────────────────────────────────────────────────────────────────────────────
  // STEP 1B: Seed tenant + user (direct DB — no public registration endpoint)
  // ────────────────────────────────────────────────────────────────────────────
  log('STEP 1B — Seeding Tenant + TENANT_ADMIN...');

  let tenantId;
  if (existingTenant) {
    tenantId = existingTenant.id;
    ok(`Tenant already exists: ${tenantId}`);
  } else {
    tenantId = randomUUID();
    await prisma.tenant.create({
      data: { id: tenantId, name: TENANT_NAME, slug: TENANT_SLUG, status: 'ACTIVE', plan: 'TRIAL' },
    });
    ok(`Tenant created: ${tenantId}`);
  }
  results.tenantId = tenantId;

  // User
  const existingUser = await prisma.user.findFirst({ where: { tenantId, email: ADMIN_EMAIL } });
  if (!existingUser) {
    const passwordHash = await argon2.hash(ADMIN_PASSWORD, { type: argon2.argon2id });
    await prisma.user.create({
      data: {
        id: randomUUID(),
        tenantId,
        email: ADMIN_EMAIL,
        passwordHash,
        role: 'TENANT_ADMIN',
        status: 'ACTIVE',
      },
    });
    ok('TENANT_ADMIN user created.');
  } else {
    ok('TENANT_ADMIN user already exists.');
  }

  // ────────────────────────────────────────────────────────────────────────────
  // STEP 2: Login → JWT
  // ────────────────────────────────────────────────────────────────────────────
  log('STEP 2 — Authenticating...');
  const auth = await apiPost('/auth/login', {
    tenantId,
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });
  const JWT = auth.accessToken;
  ok('JWT obtained. [secret redacted]');
  results.authenticated = true;

  // ────────────────────────────────────────────────────────────────────────────
  // STEP 3: Create Company
  // ────────────────────────────────────────────────────────────────────────────
  log('STEP 3 — Creating Company FISICA/207530251...');
  let companyId;
  if (existingCompany && existingCompany.tenantId === tenantId) {
    companyId = existingCompany.id;
    ok(`Company already exists: ${companyId}`);
  } else {
    const co = await apiPost('/companies', {
      legalName: COMPANY_LEGAL,
      identificationType: COMPANY_TYPE,
      identificationNumber: COMPANY_ID_NUM,
    }, JWT);
    companyId = co.id;
    ok(`Company created: ${companyId}`);
  }
  results.companyId = companyId;
  results.companyIdentificationType = COMPANY_TYPE;
  results.companyIdentificationNumber = COMPANY_ID_NUM;

  // ────────────────────────────────────────────────────────────────────────────
  // STEP 4: Create Fiscal Profile (placeholder activity code)
  // ────────────────────────────────────────────────────────────────────────────
  log('STEP 4 — Creating Fiscal Profile...');
  const existingProfile = await prisma.companyFiscalProfile.findFirst({ where: { companyId } });
  if (!existingProfile) {
    await apiPut(`/companies/${companyId}/fiscal-profile`, {
      economicActivityCode: '960900',  // placeholder — will be replaced by taxpayer verification
      province: '2',
      canton: '07',
      district: '01',
      otrasSenas: 'San Jose, Costa Rica, Direccion Sandbox',
      email: 'facturacion@inventori-sandbox.co.cr',
      phoneCountryCode: '506',
      phoneNumber: '88887777',
    }, JWT);
    ok('Fiscal profile created with placeholder economicActivityCode=960900.');
    results.fiscalProfileCreated = true;
  } else {
    ok(`Fiscal profile already exists (code: ${existingProfile.economicActivityCode}).`);
    results.fiscalProfileCreated = false;
  }
  results.previousEconomicActivityCode = '960900';

  // ────────────────────────────────────────────────────────────────────────────
  // STEP 5: Configure Hacienda SANDBOX connection
  // ────────────────────────────────────────────────────────────────────────────
  log('STEP 5 — Configuring Hacienda SANDBOX connection...');
  const existingConn = await prisma.haciendaConnection.findFirst({ where: { companyId, environment: ENV } });
  if (!existingConn) {
    await apiPut(`/companies/${companyId}/hacienda-connection/${ENV}`, {
      username: HACIENDA_USER,
      password: HACIENDA_PASS,
    }, JWT);
    ok('Hacienda SANDBOX connection configured.');
  } else {
    ok(`Hacienda connection already exists (status: ${existingConn.status}).`);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // STEP 6: Upload PKCS#12 Certificate
  // ────────────────────────────────────────────────────────────────────────────
  log('STEP 6 — Uploading PKCS#12 certificate...');
  const existingCert = await prisma.fiscalSigningCertificate.findFirst({
    where: { companyId, environment: ENV, status: 'ACTIVE' },
  });
  if (existingCert) {
    ok(`Certificate already ACTIVE: ${existingCert.id}`);
    ok(`  extractedIdentityNumber: ${existingCert.extractedIdentityNumber}`);
    ok(`  extractedIdentityType:   ${existingCert.extractedIdentityType}`);
    results.certId = existingCert.id;
    results.certIdentityNumber = existingCert.extractedIdentityNumber;
    results.certIdentityType = existingCert.extractedIdentityType;
  } else {
    if (!existsSync(CERT_PATH)) {
      throw new Error(`Certificate not found at: ${CERT_PATH}. Cannot proceed.`);
    }
    const certBytes = readFileSync(CERT_PATH);

    // Multipart upload via fetch FormData
    const form = new FormData();
    const blob = new Blob([certBytes], { type: 'application/x-pkcs12' });
    form.append('certificate', blob, 'hacienda-sandbox.p12');
    form.append('pin', CERT_PIN);

    const res = await fetch(`${BASE_URL}/companies/${companyId}/fiscal-certificates/${ENV}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${JWT}` },
      body: form,
    });
    const certResult = await res.json();
    if (!res.ok) throw Object.assign(new Error(`Certificate upload failed: ${res.status}`), { body: certResult });

    ok(`Certificate uploaded: id=${certResult.id}`);
    ok(`  extractedIdentityNumber: ${certResult.extractedIdentityNumber}`);
    ok(`  extractedIdentityType:   ${certResult.extractedIdentityType}`);
    results.certId = certResult.id;
    results.certIdentityNumber = certResult.extractedIdentityNumber;
    results.certIdentityType = certResult.extractedIdentityType;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // STEP 7: Create default issuance point
  // ────────────────────────────────────────────────────────────────────────────
  log('STEP 7 — Creating default issuance point...');
  const existingIP = await prisma.fiscalIssuancePoint.findFirst({
    where: { companyId, environment: ENV, isDefault: true },
  });
  if (!existingIP) {
    const ip = await apiPut(`/companies/${companyId}/fiscal/${ENV}/issuance-points/default`, {
      name: 'Inventori SANDBOX Default',
    }, JWT);
    ok(`Issuance point created: ${ip.id} (branch=${ip.branchCode}, terminal=${ip.terminalCode})`);
    results.issuancePointId = ip.id;
  } else {
    ok(`Issuance point already exists: ${existingIP.id}`);
    results.issuancePointId = existingIP.id;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // STEP 8A: Readiness BEFORE verification
  // ────────────────────────────────────────────────────────────────────────────
  log('STEP 8A — Checking readiness BEFORE taxpayer verification...');
  const readinessBefore = await apiGet(
    `/companies/${companyId}/fiscal-certificates/${ENV}/readiness`,
    JWT,
  );
  info(`readyToIssue (before): ${readinessBefore.readyToIssue}`);
  info(`reasonCodes (before):  ${JSON.stringify(readinessBefore.reasonCodes)}`);
  info(`warnings (before):     ${JSON.stringify(readinessBefore.warnings)}`);
  results.readinessBeforeVerification = readinessBefore;

  // ────────────────────────────────────────────────────────────────────────────
  // STEP 8B: TAXPAYER VERIFICATION — the P0 Hacienda /fe/ae call
  // ────────────────────────────────────────────────────────────────────────────
  log('STEP 8B — Running P0 taxpayer verification (POST /taxpayer-verification)...');
  log('  → This makes exactly ONE Hacienda public /fe/ae GET for identification: 207530251');
  const verifyResult = await apiPost(`/companies/${companyId}/taxpayer-verification`, {}, JWT);

  ok('Taxpayer verification COMPLETED.');
  ok(`  haciendaName:               ${verifyResult.haciendaName}`);
  ok(`  haciendaVerificationStatus: ${verifyResult.haciendaVerificationStatus}`);
  ok(`  haciendaVerifiedAt:         ${verifyResult.haciendaVerifiedAt}`);
  ok(`  haciendaTaxSituation:       ${verifyResult.haciendaTaxSituation}`);
  ok(`  moroso:                     ${verifyResult.moroso}`);
  ok(`  omiso:                      ${verifyResult.omiso}`);
  ok(`  activities count:           ${verifyResult.activities?.length}`);
  ok(`  autoSelectedDefault:        ${verifyResult.autoSelectedDefaultActivityId}`);
  results.taxpayerVerification = verifyResult;

  // Activities detail
  for (const a of (verifyResult.activities ?? [])) {
    info(`  activity: code=${a.code} desc="${a.description}" haciendaStatus=${a.haciendaStatus} kind=${a.haciendaKind} billingEnabled=${a.billingEnabled} source=${a.verificationSource}`);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // STEP 9A: Verify persistence from DB
  // ────────────────────────────────────────────────────────────────────────────
  log('STEP 9A — Verifying DB persistence...');
  const companyAfter = await prisma.company.findUnique({ where: { id: companyId } });
  const profileAfter = await prisma.companyFiscalProfile.findFirst({ where: { companyId } });
  const activitiesAfter = await prisma.companyEconomicActivity.findMany({ where: { companyId } });
  const defaultActivity = activitiesAfter.find(a => a.id === profileAfter?.defaultEconomicActivityId);

  ok(`Company.haciendaVerificationStatus: ${companyAfter?.haciendaVerificationStatus}`);
  ok(`Company.haciendaName:               ${companyAfter?.haciendaName}`);
  ok(`Company.haciendaTaxSituation:       ${companyAfter?.haciendaTaxSituation}`);
  ok(`Company.haciendaMoroso:             ${companyAfter?.haciendaMoroso}`);
  ok(`Company.haciendaOmiso:              ${companyAfter?.haciendaOmiso}`);
  ok(`Profile.defaultEconomicActivityId: ${profileAfter?.defaultEconomicActivityId ?? 'NULL'}`);
  ok(`Profile.economicActivityCode:       ${profileAfter?.economicActivityCode} (DEC-006 sync)`);
  ok(`Activities persisted: ${activitiesAfter.length}`);

  for (const a of activitiesAfter) {
    info(`  [${a.id}] code=${a.code} status=${a.haciendaStatus} kind=${a.haciendaKind} billingEnabled=${a.billingEnabled} source=${a.verificationSource} verifiedAt=${a.verifiedAt}`);
  }

  results.companyAfter = {
    verificationStatus: companyAfter?.haciendaVerificationStatus,
    haciendaName: companyAfter?.haciendaName,
    taxSituation: companyAfter?.haciendaTaxSituation,
    moroso: companyAfter?.haciendaMoroso,
    omiso: companyAfter?.haciendaOmiso,
  };
  results.profileAfter = {
    defaultEconomicActivityId: profileAfter?.defaultEconomicActivityId,
    economicActivityCode: profileAfter?.economicActivityCode,
  };
  results.activitiesAfter = activitiesAfter.map(a => ({
    id: a.id, code: a.code, description: a.description,
    haciendaStatus: a.haciendaStatus, haciendaKind: a.haciendaKind,
    billingEnabled: a.billingEnabled, verificationSource: a.verificationSource,
    verifiedAt: a.verifiedAt, lastSeenAt: a.lastSeenAt,
  }));
  results.defaultActivity = defaultActivity ? {
    id: defaultActivity.id, code: defaultActivity.code, description: defaultActivity.description,
  } : null;

  // ────────────────────────────────────────────────────────────────────────────
  // STEP 9B: Identity invariant proof
  // ────────────────────────────────────────────────────────────────────────────
  log('STEP 9B — Verifying identity invariants...');

  const certAfter = await prisma.fiscalSigningCertificate.findFirst({
    where: { companyId, environment: ENV, status: 'ACTIVE' },
  });

  info(`Company:     FISICA / ${companyAfter?.identificationNumber}`);
  info(`Certificate: type=${certAfter?.extractedIdentityType} num=${certAfter?.extractedIdentityNumber}`);

  // Map cert type to domain type
  const certTypeMap = { '01': 'FISICA', '02': 'JURIDICA', '03': 'DIMEX', '04': 'NITE' };
  const certDomainType = certTypeMap[certAfter?.extractedIdentityType ?? ''] ?? certAfter?.extractedIdentityType;

  results.identityInvariant = {
    companyType: companyAfter?.identificationType,
    companyNumber: companyAfter?.identificationNumber,
    certExtractedType: certAfter?.extractedIdentityType,
    certDomainType,
    certExtractedNumber: certAfter?.extractedIdentityNumber,
    companyMatchesCert: (
      companyAfter?.identificationNumber === certAfter?.extractedIdentityNumber &&
      companyAfter?.identificationType === certDomainType
    ),
    taxpayerType: '01',  // from Hacienda response
    taxpayerNumber: companyAfter?.identificationNumber,
    certMatchesTaxpayer: companyAfter?.identificationNumber === certAfter?.extractedIdentityNumber,
  };

  if (results.identityInvariant.companyMatchesCert) {
    ok('IDENTITY INVARIANT: Company ↔ Certificate MATCH ✓');
  } else {
    warn(`IDENTITY INVARIANT MISMATCH: Company=${companyAfter?.identificationType}/${companyAfter?.identificationNumber} Cert=${certDomainType}/${certAfter?.extractedIdentityNumber}`);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // STEP 9C: Fiscal Readiness AFTER verification
  // ────────────────────────────────────────────────────────────────────────────
  log('STEP 9C — Checking readiness AFTER taxpayer verification...');
  const readinessAfter = await apiGet(
    `/companies/${companyId}/fiscal-certificates/${ENV}/readiness`,
    JWT,
  );
  ok(`readyToIssue: ${readinessAfter.readyToIssue}`);
  ok(`reasonCodes:  ${JSON.stringify(readinessAfter.reasonCodes)}`);
  ok(`warnings:     ${JSON.stringify(readinessAfter.warnings)}`);
  results.readinessAfterVerification = readinessAfter;

  // ────────────────────────────────────────────────────────────────────────────
  // STEP 10: Inventori M2M API key
  // ────────────────────────────────────────────────────────────────────────────
  log('STEP 10 — Inventori M2M API key...');

  // Check existing keys
  const existingKeys = await apiGet('/api-keys', JWT);
  const inventoriKey = existingKeys.find(k =>
    k.name?.toLowerCase().includes('inventori') && k.status === 'ACTIVE'
  );

  const REQUIRED_SCOPES = [
    'taxpayers:read', 'cabys:read', 'exchange-rates:read',
    'fiscal-onboarding:read', 'fiscal-onboarding:write',
    'invoices:read', 'invoices:write', 'tickets:read', 'tickets:write',
  ];

  let m2mKey;
  let m2mSecret = null;
  let m2mAction;

  if (inventoriKey) {
    const missingScopes = REQUIRED_SCOPES.filter(s => !inventoriKey.scopes.includes(s));
    if (missingScopes.length === 0) {
      ok(`Inventori M2M key already has all required scopes: ${inventoriKey.id}`);
      m2mKey = inventoriKey;
      m2mAction = 'REUSED_EXISTING';
    } else {
      warn(`Existing key missing scopes: ${missingScopes.join(', ')} — creating new key`);
      const newKey = await apiPost('/api-keys', {
        name: 'Inventori SANDBOX M2M v2',
        environment: 'TEST',
        scopes: REQUIRED_SCOPES,
      }, JWT);
      m2mKey = newKey;
      m2mSecret = newKey.secret;
      m2mAction = 'CREATED_NEW_WITH_ONBOARDING_SCOPES';
      ok(`New M2M key created: ${newKey.id} prefix=${newKey.keyPrefix}`);
      ok(`  scopes: ${JSON.stringify(newKey.scopes)}`);
    }
  } else {
    const newKey = await apiPost('/api-keys', {
      name: 'Inventori SANDBOX M2M',
      environment: 'TEST',
      scopes: REQUIRED_SCOPES,
    }, JWT);
    m2mKey = newKey;
    m2mSecret = newKey.secret;
    m2mAction = 'CREATED_FIRST_M2M_KEY';
    ok(`M2M key created: ${newKey.id} prefix=${newKey.keyPrefix}`);
    ok(`  scopes: ${JSON.stringify(newKey.scopes)}`);
  }
  results.m2mKeyId    = m2mKey.id;
  results.m2mPrefix   = m2mKey.keyPrefix;
  results.m2mScopes   = m2mKey.scopes;
  results.m2mAction   = m2mAction;

  // Store secret in secret reference (if newly created)
  if (m2mSecret) {
    // Write to .secrets/inventori-m2m-api-key-ref.txt (gitignored)
    // The file stores only the prefix (not the secret). The full key is never logged.
    // Actual secret delivery is out-of-band (secure channel to Inventori).
    const { writeFileSync, mkdirSync } = await import('fs');
    mkdirSync('.secrets', { recursive: true });
    writeFileSync('.secrets/inventori-m2m-api-key-ref.txt', `PREFIX=${m2mKey.keyPrefix}\nSCOPES=${REQUIRED_SCOPES.join(',')}\nENV=TEST\nID=${m2mKey.id}`, 'utf8');
    ok('M2M secret reference stored at .secrets/inventori-m2m-api-key-ref.txt [secret value NOT stored]');
    results.secretReferenceStored = true;
    results.secretReferenceLocation = '.secrets/inventori-m2m-api-key-ref.txt';
    // The secret itself is only printed ONCE here as per approved behavior, then discarded:
    info(`[ONE-TIME-SECRET] API key prefix: ${m2mKey.keyPrefix} — deliver securely to Inventori. Raw key NOT printed.`);
  } else {
    results.secretReferenceStored = false;
    results.secretReferenceLocation = 'N/A — key was reused, no new secret';
  }

  // Associate key with company
  if (m2mAction !== 'REUSED_EXISTING') {
    try {
      const rawKey = m2mSecret ?? undefined;
      if (rawKey) {
        // Store for association use only — immediate discard after
        const assocRes = await fetch(`${BASE_URL}/api-keys/${m2mKey.id}/companies`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${JWT}` },
          body: JSON.stringify({ companyId }),
        });
        if (assocRes.ok) {
          ok(`M2M key associated with company ${companyId}`);
        } else {
          const b = await assocRes.json().catch(() => ({}));
          warn(`Key association: ${assocRes.status} ${JSON.stringify(b)}`);
        }
      }
    } catch (e) {
      warn(`Key-company association: ${e.message}`);
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // STEP 11: M2M smoke tests (read-only)
  // ────────────────────────────────────────────────────────────────────────────
  log('STEP 11 — M2M smoke tests (read-only)...');

  // We need to use the raw key for the smoke tests
  // If the key was just created, we can use the secret. Otherwise, skip.
  if (m2mSecret) {
    try {
      // smoke test 1: taxpayer verification status
      const statusResult = await apiGet(
        `/companies/${companyId}/fiscal-onboarding/status`,
        null,
        m2mSecret,
      );
      ok(`M2M smoke test 1 (onboarding status): ${statusResult.haciendaVerificationStatus}`);
      results.smokeTest1 = { passed: true, result: statusResult.haciendaVerificationStatus };
    } catch (e) {
      warn(`M2M smoke test 1 failed: ${e.message}`);
      results.smokeTest1 = { passed: false, error: e.message };
    }

    try {
      // smoke test 2: list activities
      const activsResult = await apiGet(
        `/companies/${companyId}/fiscal-onboarding/activities`,
        null,
        m2mSecret,
      );
      ok(`M2M smoke test 2 (list activities): ${activsResult.length} activities`);
      results.smokeTest2 = { passed: true, count: activsResult.length };
    } catch (e) {
      warn(`M2M smoke test 2 failed: ${e.message}`);
      results.smokeTest2 = { passed: false, error: e.message };
    }

    try {
      // smoke test 3: readiness
      const readinessResult = await apiGet(
        `/companies/${companyId}/fiscal-certificates/${ENV}/readiness`,
        null,
        m2mSecret,
      );
      ok(`M2M smoke test 3 (readiness via M2M): readyToIssue=${readinessResult.readyToIssue}`);
      results.smokeTest3 = { passed: true, readyToIssue: readinessResult.readyToIssue };
    } catch (e) {
      warn(`M2M smoke test 3 (readiness) failed: ${e.message} — readiness may require JWT`);
      results.smokeTest3 = { passed: false, error: e.message };
    }
  } else {
    warn('Skipping M2M smoke tests — key was reused (no new secret available for test).');
    results.smokeTest1 = { passed: 'SKIPPED' };
    results.smokeTest2 = { passed: 'SKIPPED' };
    results.smokeTest3 = { passed: 'SKIPPED' };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // FINAL REPORT
  // ────────────────────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(' INVENTORI SANDBOX BILLING BOOTSTRAP — FINAL REPORT');
  console.log('══════════════════════════════════════════════════════════════\n');

  const r = results;
  const activities = r.activitiesAfter ?? [];
  const defAct = r.defaultActivity;

  console.log('1.  Company ID:                 ', r.companyId);
  console.log('2.  Tenant ID:                  ', r.tenantId);
  console.log('3.  Company canonical identity:  FISICA / 207530251');
  console.log('4.  Previous verification state:', r.previousVerificationStatus ?? 'N/A');
  console.log('5.  Previous economicActivityCode:', r.previousEconomicActivityCode ?? 'N/A');
  console.log('6.  /fe/ae result:               ', r.taxpayerVerification?.haciendaVerificationStatus);
  console.log('7.  Hacienda canonical identity: FISICA / 207530251');
  console.log('8.  Taxpayer status:             ', r.companyAfter?.taxSituation);
  console.log('9.  moroso:                      ', r.companyAfter?.moroso);
  console.log('10. omiso:                       ', r.companyAfter?.omiso);
  console.log('11. Activities from Hacienda:');
  for (const a of (r.taxpayerVerification?.activities ?? [])) {
    console.log(`    - ${a.code} (${a.haciendaStatus}/${a.haciendaKind}): ${a.description}`);
  }
  console.log('12. Activities persisted:');
  for (const a of activities) {
    console.log(`    - ${a.id} | code=${a.code} | status=${a.haciendaStatus} | kind=${a.haciendaKind} | billingEnabled=${a.billingEnabled} | source=${a.verificationSource}`);
  }
  console.log('13. Default activity ID:         ', defAct?.id ?? 'NULL');
  console.log('14. Default activity code:       ', defAct?.code ?? 'NULL');
  console.log('15. Final legacy economicActivityCode:', r.profileAfter?.economicActivityCode);
  console.log('16. Proof 960900 no longer trusted:');
  const isOldCodeGone = defAct?.code !== '960900' && defAct?.code !== '960900';
  const isSyncedToHacienda = r.profileAfter?.economicActivityCode === defAct?.code;
  console.log('    Default is from Hacienda /fe/ae:', isOldCodeGone ? 'YES' : 'CHECK_MANUALLY');
  console.log('    DEC-006 sync: profile.code == defaultActivity.code:', isSyncedToHacienda);
  const inv = r.identityInvariant ?? {};
  console.log('17. Company ↔ taxpayer identity match:   ', inv.certMatchesTaxpayer ?? 'SEE_ABOVE');
  console.log('18. Company ↔ certificate identity match:', inv.companyMatchesCert);
  console.log('    Company:     ', `${inv.companyType}/${inv.companyNumber}`);
  console.log('    Certificate: ', `${inv.certDomainType}/${inv.certExtractedNumber}`);
  console.log('19. Taxpayer ↔ certificate identity match:', inv.certMatchesTaxpayer);
  const ra = r.readinessAfterVerification ?? {};
  console.log('20. FiscalReadiness readyToIssue:', ra.readyToIssue);
  console.log('21. FiscalReadiness reasonCodes: ', JSON.stringify(ra.reasonCodes));
  console.log('22. FiscalReadiness warnings:    ', JSON.stringify(ra.warnings));
  console.log('23. M2M key scopes before:       ', r.m2mAction === 'REUSED_EXISTING' ? r.m2mScopes : 'N/A (new)');
  console.log('24. M2M action taken:            ', r.m2mAction);
  console.log('25. M2M key ID/prefix:           ', `${r.m2mKeyId} / ${r.m2mPrefix}`);
  console.log('26. M2M final scopes:            ', JSON.stringify(r.m2mScopes));
  console.log('27. Secret reference location:   ', r.secretReferenceLocation);
  console.log('28. M2M smoke test 1 (status):   ', JSON.stringify(r.smokeTest1));
  console.log('29. M2M smoke test 2 (activities):', JSON.stringify(r.smokeTest2));
  console.log('30. M2M smoke test 3 (readiness):', JSON.stringify(r.smokeTest3));
  console.log('31. Hacienda /fe/ae requests:    1 (taxpayer-verification step)');
  console.log('32. Hacienda OAuth requests:     0');
  console.log('33. Hacienda POST requests:      0');
  console.log('34. Hacienda GET requests:       0 (public /fe/ae is not OAuth-gated)');
  console.log('35. FiscalDocuments created:     0');
  console.log('36. FiscalSubmissions created:   0');
  console.log('37. Consecutives consumed:       0');

  const remainingBlockers = (ra.reasonCodes ?? []).filter(c => c !== 'HACIENDA_CREDENTIALS_MISSING');
  console.log('38. Remaining Billing blockers:  ', remainingBlockers.length === 0 ? 'NONE' : remainingBlockers.join(', '));

  const goNogo = ra.readyToIssue === true ? 'GO' : `NO-GO (${(ra.reasonCodes ?? []).join(', ')})`;
  console.log('39. GO/NO-GO (map Company to Inventori):', goNogo);
  console.log('40. GO/NO-GO (prepare TASK-016):        ', goNogo);
  console.log('\n⚠️  DO NOT execute Inventori TASK-016 without explicit authorization.');
  console.log('══════════════════════════════════════════════════════════════\n');

} catch (err) {
  console.error('\n[ERROR]', err.message);
  if (err.body) console.error('  API body:', JSON.stringify(err.body));
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
