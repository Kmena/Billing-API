'use strict';

const http = require('http');
const {
  loadLocalSecretEnv,
  requireHaciendaSandboxCredentials,
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

function httpRequest(url, method, body, authorization) {
  return new Promise((resolve, reject) => {
    const payload = body ? Buffer.from(JSON.stringify(body), 'utf8') : undefined;
    const request = http.request(
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
      (response) => {
        let responseBody = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { responseBody += chunk; });
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body: responseBody }));
      },
    );
    request.once('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}

async function main() {
  loadLocalSecretEnv();
  if (process.env.ALLOW_HACIENDA_SANDBOX_CREDENTIAL_ROTATION !== 'true') {
    throw new Error('Set ALLOW_HACIENDA_SANDBOX_CREDENTIAL_ROTATION=true for an explicitly authorized rotation.');
  }
  const admin = requireLocalAdminCredentials();
  const hacienda = requireHaciendaSandboxCredentials();
  const companyId = requireLocalSecret('INVENTORI_SANDBOX_COMPANY_ID');
  const baseUrl = localApiBaseUrl();

  const login = await httpRequest(new URL('/api/v1/auth/login', baseUrl), 'POST', admin);
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

  const configured = await httpRequest(
    new URL(`/api/v1/companies/${companyId}/hacienda-connection/SANDBOX`, baseUrl),
    'PUT',
    hacienda,
    `Bearer ${accessToken}`,
  );
  if (configured.status < 200 || configured.status >= 300) {
    throw new Error(`Hacienda SANDBOX connection configuration failed (HTTP ${configured.status}).`);
  }

  process.stdout.write('[OK] Hacienda SANDBOX connection configured.\n');
}

main().catch((error) => {
  process.stderr.write(`[FAIL] ${error instanceof Error ? error.message : 'local configuration failed'}\n`);
  process.exit(1);
});
