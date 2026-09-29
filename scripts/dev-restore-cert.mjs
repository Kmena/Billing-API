/**
 * dev-restore-cert.mjs — LOCAL DEVELOPMENT ONLY
 *
 * Re-uploads the Inventori SANDBOX PKCS#12 fiscal certificate to Billing via the
 * authoritative HTTP API endpoint (POST /companies/:id/fiscal-certificates/SANDBOX).
 *
 * When to run:
 *   - After a fresh LocalStack start with empty SSM (cert secrets were lost)
 *   - After `docker compose restart localstack` (Community Edition loses SSM state)
 *   - After `docker compose down -v` + restore
 *
 * Prerequisites:
 *   1. npm run dev:seed-ssm   ← seed JWT_SECRET into LocalStack SSM
 *   2. npm run start:dev      ← Billing running with SECRET_PROVIDER=ssm
 *   3. node scripts/dev-restore-cert.mjs  ← this script
 *
 * Safe invariants:
 *   - P12 bytes go to Billing API via in-memory multipart (multer.memoryStorage, never to disk)
 *   - The cert and PIN are NOT printed by this script
 *   - Zero Hacienda traffic, zero FiscalDocuments, zero consecutives
 *
 * Reads from .env.local (gitignored):
 *   INVENTORI_SANDBOX_TENANT_ID, INVENTORI_SANDBOX_COMPANY_ID,
 *   F4S_SANDBOX_CERT_PATH (.secrets/hacienda-sandbox.p12), F4S_SANDBOX_CERT_PIN
 */

import { readFileSync } from 'fs';
import http from 'http';

// ── Load .env.local ───────────────────────────────────────────────────────────
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
const CERT_PATH  = process.env.F4S_SANDBOX_CERT_PATH ?? '.secrets/hacienda-sandbox.p12';
const CERT_PIN   = process.env.F4S_SANDBOX_CERT_PIN;
const BASE_URL   = `http://localhost:${process.env.PORT ?? 3000}/api/v1`;
const ADMIN_EMAIL    = 'admin@inventori-sandbox.billing';
const ADMIN_PASSWORD = 'Admin@Billing2026!';

if (!TENANT_ID || !COMPANY_ID) {
  console.error('[FAIL] INVENTORI_SANDBOX_TENANT_ID or INVENTORI_SANDBOX_COMPANY_ID not set in .env.local');
  process.exit(1);
}
if (!CERT_PIN) {
  console.error('[FAIL] F4S_SANDBOX_CERT_PIN not set in .env.local');
  process.exit(1);
}

function httpRequest(opts, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ── 1. Login ──────────────────────────────────────────────────────────────────
const loginPayload = JSON.stringify({ tenantId: TENANT_ID, email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
const loginUrl = new URL(`${BASE_URL}/auth/login`);
const loginResp = await httpRequest({
  hostname: loginUrl.hostname, port: parseInt(loginUrl.port), path: loginUrl.pathname,
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(loginPayload) }
}, loginPayload);

if (loginResp.status !== 200) {
  console.error('[FAIL] Login failed:', loginResp.status);
  console.error('       Hint: make sure Billing is running and JWT_SECRET is seeded in SSM.');
  console.error('       Run: npm run dev:seed-ssm && npm run start:dev');
  process.exit(1);
}
const jwt = JSON.parse(loginResp.body).accessToken;
console.log('[OK] Login successful');

// ── 2. Build multipart/form-data ──────────────────────────────────────────────
const certBytes = readFileSync(CERT_PATH);
const boundary = `----FormBoundary${Date.now().toString(16)}`;
const crlf = '\r\n';

const body = Buffer.concat([
  Buffer.from(`--${boundary}${crlf}`),
  Buffer.from(`Content-Disposition: form-data; name="certificate"; filename="cert.p12"${crlf}`),
  Buffer.from(`Content-Type: application/x-pkcs12${crlf}${crlf}`),
  certBytes,
  Buffer.from(crlf),
  Buffer.from(`--${boundary}${crlf}`),
  Buffer.from(`Content-Disposition: form-data; name="pin"${crlf}${crlf}`),
  Buffer.from(CERT_PIN),
  Buffer.from(crlf),
  Buffer.from(`--${boundary}--${crlf}`),
]);

// ── 3. POST /companies/:id/fiscal-certificates/SANDBOX ────────────────────────
const uploadUrl = new URL(`${BASE_URL}/companies/${COMPANY_ID}/fiscal-certificates/SANDBOX`);
const uploadResp = await httpRequest({
  hostname: uploadUrl.hostname,
  port: parseInt(uploadUrl.port),
  path: uploadUrl.pathname,
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${jwt}`,
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
    'Content-Length': body.length,
  }
}, body);

if (uploadResp.status === 201) {
  const result = JSON.parse(uploadResp.body);
  console.log('[OK] Certificate uploaded and stored in SSM');
  console.log('     New ACTIVE cert id:', result.id);
  console.log('     Fingerprint (first 16 chars):', result.fingerprintSha256?.substring(0, 16) + '...');
  console.log('     P12/PIN NOT in response (safe metadata only)');
} else {
  console.error('[FAIL] Certificate upload failed:', uploadResp.status);
  console.error('       Response:', uploadResp.body);
  process.exit(1);
}
