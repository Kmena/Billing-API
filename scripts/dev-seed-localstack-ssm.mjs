/**
 * dev-seed-localstack-ssm.mjs — LOCAL DEVELOPMENT ONLY
 *
 * Seeds non-fiscal application secrets into LocalStack SSM so that Billing
 * can start with SECRET_PROVIDER=ssm pointing at http://localhost:4566.
 *
 * When to run:
 *   - After a fresh LocalStack start (empty SSM) with PERSISTENCE=1 not yet having data
 *   - After `docker compose down -v` + `docker compose up localstack -d`
 *   - After any localstack_data volume wipe
 *
 * NOT needed if LocalStack was merely restarted with PERSISTENCE=1 (state survives).
 *
 * Safe: reads from .env.local (gitignored). Never commits real values.
 * Requires: LocalStack running at AWS_SSM_ENDPOINT (default http://localhost:4566).
 * Requires: .env.local with JWT_SECRET and AWS_SSM_ENDPOINT set.
 *
 * Usage:
 *   node scripts/dev-seed-localstack-ssm.mjs
 */

import { readFileSync } from 'fs';
import { SSMClient, PutParameterCommand } from '@aws-sdk/client-ssm';

// ── Load .env.local ────────────────────────────────────────────────────────────
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

const endpoint = process.env.AWS_SSM_ENDPOINT;
const prefix   = process.env.SSM_PARAMETER_PREFIX ?? '/billing/dev';
const jwtSecret = process.env.JWT_SECRET;

if (!endpoint) {
  console.error('[FAIL] AWS_SSM_ENDPOINT not set in .env.local');
  console.error('       Expected: http://localhost:4566');
  process.exit(1);
}
if (!jwtSecret) {
  console.error('[FAIL] JWT_SECRET not set in .env.local');
  process.exit(1);
}
if (jwtSecret.length < 32) {
  console.warn('[WARN] JWT_SECRET is shorter than 32 chars — fine for dev, not for prod');
}

const client = new SSMClient({
  region: process.env.AWS_REGION ?? 'us-east-1',
  endpoint,
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
});

async function seed(key, value, description) {
  const name = `${prefix}/${key}`;
  await client.send(new PutParameterCommand({
    Name: name,
    Value: value,
    Type: 'SecureString',
    Overwrite: true,
    Description: description,
  }));
  // Do NOT log the value — only the parameter path
  console.log(`[OK] Seeded: ${name}`);
}

console.log(`[INFO] Seeding non-fiscal app secrets → LocalStack SSM at ${endpoint}`);
console.log(`[INFO] Parameter prefix: ${prefix}`);

// Seed only the application-level secrets needed for Billing startup.
// Fiscal certificate secrets (fiscal-certs/...) are seeded by the certificate
// upload flow (UploadFiscalSigningCertificateService), not by this script.
await seed('JWT_SECRET', jwtSecret, 'JWT signing secret — local dev only');

console.log('[OK] SSM seed complete.');
console.log('[INFO] You can now start Billing: npm run start:dev');
console.log('[INFO] After Billing starts, re-upload the fiscal certificate if SSM was wiped.');
