'use strict';

const http = require('http');
const {
  loadLocalSecretEnv,
  requireLocalAdminCredentials,
  requireLocalSecret,
} = require('./local-secret-env.cjs');

function localApiBaseUrl() {
  const raw = process.env.BILLING_LOCAL_API_BASE_URL ?? `http://localhost:${process.env.PORT ?? '3000'}/api/v1`;
  const url = new URL(raw);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('BILLING_LOCAL_API_BASE_URL must target local Billing.');
  }
  return url;
}

function request(url, method, body, authorization) {
  return new Promise((resolve, reject) => {
    const payload = body ? Buffer.from(JSON.stringify(body), 'utf8') : undefined;
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        method,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
          ...(authorization ? { Authorization: authorization } : {}),
        },
      },
      (res) => {
        let responseBody = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { responseBody += chunk; });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: responseBody }));
      },
    );
    req.once('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  loadLocalSecretEnv();
  if (process.env.ALLOW_HACIENDA_SANDBOX_VALIDATION !== 'true') {
    throw new Error('Set ALLOW_HACIENDA_SANDBOX_VALIDATION=true for an explicitly authorized validation.');
  }

  const admin = requireLocalAdminCredentials();
  const companyId = requireLocalSecret('INVENTORI_SANDBOX_COMPANY_ID');
  const baseUrl = localApiBaseUrl();
  const login = await request(new URL('/api/v1/auth/login', baseUrl), 'POST', admin);

  if (login.status !== 200 && login.status !== 201) {
    throw new Error(`Local Billing administrator authentication failed (HTTP ${login.status}).`);
  }

  let accessToken;
  try {
    accessToken = JSON.parse(login.body).accessToken;
  } catch {
    throw new Error('Local Billing login response did not contain an access token.');
  }
  if (!accessToken || typeof accessToken !== 'string') {
    throw new Error('Local Billing login response did not contain an access token.');
  }

  const validation = await request(
    new URL(`/api/v1/companies/${companyId}/hacienda-connection/SANDBOX/validate`, baseUrl),
    'POST',
    undefined,
    `Bearer ${accessToken}`,
  );
  process.stdout.write(`Hacienda SANDBOX validation HTTP: ${validation.status}\n`);
  if (validation.status < 200 || validation.status >= 300) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`[FAIL] ${error instanceof Error ? error.message : 'validation failed'}\n`);
  process.exit(1);
});
