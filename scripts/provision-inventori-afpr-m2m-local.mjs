/**
 * One-shot LOCAL development provisioner for the Inventori AFPR replacement key.
 *
 * Reads a short-lived TENANT_ADMIN JWT from stdin. The token is never persisted,
 * printed, or accepted through command-line arguments. The Billing API performs
 * the authorization, creation, company binding, and audit operations.
 */
import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { constants as fsConstants, existsSync } from 'node:fs';
import { join } from 'node:path';

const REQUIRED_SCOPES = [
  'taxpayers:read',
  'cabys:read',
  'exchange-rates:read',
  'fiscal-onboarding:read',
  'fiscal-onboarding:write',
  'fiscal-credentials:write',
  'fiscal-credentials:validate',
  'invoices:read',
  'invoices:write',
  'tickets:read',
  'tickets:write',
];
const AFPR_SCOPE = 'fiscal-deliveries:resend';
const EXPECTED_SCOPES = [...REQUIRED_SCOPES, AFPR_SCOPE];
const HANDOFF_PATH = join('.secrets', 'inventori-m2m-afpr-next.env');
const LOCK_PATH = join('.secrets', 'inventori-m2m-afpr-provision.lock');

function loadLocalEnvironment() {
  if (!existsSync('.env.local')) throw new Error('Missing .env.local local configuration.');
  return readFile('.env.local', 'utf8').then((content) => {
    for (const raw of content.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const separator = line.indexOf('=');
      if (separator < 1) continue;
      const key = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim();
      if (key && !process.env[key]) process.env[key] = value;
    }
  });
}

function requireValue(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required local configuration: ${name}.`);
  return value;
}

function assertLocalRuntime() {
  if (process.env.NODE_ENV !== 'development') {
    throw new Error('This provisioner is allowed only when NODE_ENV=development.');
  }
  const baseUrl = new URL(`http://localhost:${requireValue('PORT')}/api/v1`);
  if (baseUrl.protocol !== 'http:' || !['localhost', '127.0.0.1', '::1'].includes(baseUrl.hostname)) {
    throw new Error('This provisioner only permits the local Billing API.');
  }
  return baseUrl.toString().replace(/\/$/, '');
}

function sameScopes(actual, expected) {
  return actual.length === expected.length && actual.every((scope) => expected.includes(scope));
}

async function readAdminJwt() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const token = Buffer.concat(chunks).toString('utf8').trim();
  if (!/^[-A-Za-z0-9_]+\.[-A-Za-z0-9_]+\.[-A-Za-z0-9_]+$/.test(token)) {
    throw new Error('A single valid short-lived administrator JWT is required on stdin.');
  }
  return token;
}

async function request(baseUrl, path, token, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
  });
  const payload = response.status === 204 ? undefined : await response.json().catch(() => undefined);
  if (!response.ok) throw new Error(`Billing local API rejected ${options.method ?? 'GET'} ${path} (${response.status}).`);
  return payload;
}

async function main() {
  await loadLocalEnvironment();
  const baseUrl = assertLocalRuntime();
  const tenantId = requireValue('INVENTORI_SANDBOX_TENANT_ID');
  const companyId = requireValue('INVENTORI_SANDBOX_COMPANY_ID');
  const currentKeyId = requireValue('INVENTORI_M2M_API_KEY_ID');

  await mkdir('.secrets', { recursive: true, mode: 0o700 });
  if (existsSync(HANDOFF_PATH)) throw new Error('Secure handoff already exists; refusing to overwrite it.');

  let lockHandle;
  let handoffHandle;
  let adminJwt;
  let createdKey;
  let handoffStored = false;
  try {
    lockHandle = await open(LOCK_PATH, 'wx', 0o600);
    handoffHandle = await open(HANDOFF_PATH, 'wx', 0o600);
    adminJwt = await readAdminJwt();

    const existingKeys = await request(baseUrl, '/api-keys', adminJwt);
    const oldKey = existingKeys.find((key) => key.id === currentKeyId);
    if (
      !oldKey ||
      oldKey.status !== 'ACTIVE' ||
      oldKey.environment !== 'TEST' ||
      !sameScopes(oldKey.scopes, REQUIRED_SCOPES)
    ) {
      throw new Error('The configured Inventori M2M key is not the expected active TEST key with the canonical 11 scopes.');
    }
    if (existingKeys.some((key) => key.name?.startsWith('Inventori SANDBOX M2M AFPR replacement') && key.status === 'ACTIVE')) {
      throw new Error('An active AFPR replacement key already exists; refusing duplicate provisioning.');
    }

    createdKey = await request(baseUrl, '/api-keys', adminJwt, {
      method: 'POST',
      body: JSON.stringify({
        name: `Inventori SANDBOX M2M AFPR replacement ${new Date().toISOString().slice(0, 10)}`,
        environment: 'TEST',
        scopes: EXPECTED_SCOPES,
      }),
    });
    if (
      createdKey.status !== 'ACTIVE' ||
      !sameScopes(createdKey.scopes, EXPECTED_SCOPES) ||
      typeof createdKey.secret !== 'string' ||
      createdKey.secret.length < 1
    ) {
      throw new Error('Billing returned an invalid replacement API key response.');
    }

    const binding = await request(baseUrl, `/api-keys/${createdKey.id}/companies`, adminJwt, {
      method: 'POST',
      body: JSON.stringify({ companyId }),
    });
    if (!binding || typeof binding.created !== 'boolean') {
      throw new Error('Billing did not confirm the company-scoped API key authorization.');
    }

    await handoffHandle.writeFile(
      [
        '# LOCAL ONLY — pending Inventori switch; this file is gitignored.',
        `INVENTORI_M2M_API_KEY_NEXT=${createdKey.secret}`,
        `INVENTORI_M2M_API_KEY_NEXT_ID=${createdKey.id}`,
        `INVENTORI_M2M_API_KEY_NEXT_PREFIX=${createdKey.keyPrefix}`,
        '',
      ].join('\n'),
      'utf8',
    );
    await handoffHandle.sync();
    handoffStored = true;

    const verifiedKeys = await request(baseUrl, '/api-keys', adminJwt);
    const verified = verifiedKeys.find((key) => key.id === createdKey.id);
    if (!verified || verified.status !== 'ACTIVE' || !sameScopes(verified.scopes, EXPECTED_SCOPES)) {
      throw new Error('Replacement API key verification failed after provisioning.');
    }

    // Read-only scope and ApiKeyCompany validation; it cannot initiate fiscal work.
    await request(
      baseUrl,
      `/companies/${companyId}/fiscal-onboarding/status`,
      createdKey.secret,
      { headers: { 'X-API-Key': createdKey.secret }, method: 'GET' },
    );

    console.log('LOCAL_M2M_AFPR_PROVISIONING_COMPLETE');
    console.log('NEW_KEY_ACTIVE=YES');
    console.log('NEW_KEY_SCOPE_COUNT=12');
    console.log('AFPR_SCOPE_PRESENT=YES');
    console.log('SECURE_HANDOFF=.secrets/inventori-m2m-afpr-next.env');
  } catch (error) {
    if (createdKey && !handoffStored && adminJwt) {
      await request(baseUrl, `/api-keys/${createdKey.id}`, adminJwt, { method: 'DELETE' }).catch(() => undefined);
    }
    throw error;
  } finally {
    if (handoffHandle) await handoffHandle.close().catch(() => undefined);
    if (!handoffStored && existsSync(HANDOFF_PATH)) await unlink(HANDOFF_PATH).catch(() => undefined);
    if (lockHandle) await lockHandle.close().catch(() => undefined);
    if (existsSync(LOCK_PATH)) await unlink(LOCK_PATH).catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(`LOCAL_M2M_AFPR_PROVISIONING_FAILED: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exitCode = 1;
});

