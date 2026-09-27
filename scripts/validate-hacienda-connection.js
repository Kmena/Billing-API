'use strict';
const http = require('http');

function httpReq(method, path, headers, body) {
  return new Promise((resolve, reject) => {
    const opts = { hostname: 'localhost', port: 3000, path, method, headers };
    const req = http.request(opts, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve({ s: res.statusCode, b: d }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function main() {
  const lb = JSON.stringify({ tenantId: '25ae538c-b272-407b-83d0-ccc78be3c658', email: 'admin@inventori-sandbox.billing', password: 'Admin@Billing2026!' });
  const lr = await httpReq('POST', '/api/v1/auth/login', { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(lb) }, lb);
  process.stdout.write(`Login: ${lr.s}\n`);
  const tk = JSON.parse(lr.b).accessToken;

  process.stdout.write('Validating Hacienda SANDBOX connection...\n');
  const vr = await httpReq('POST',
    '/api/v1/companies/dde91f44-6ceb-4eb7-b322-0139919cc34d/hacienda-connection/SANDBOX/validate',
    { 'Authorization': `Bearer ${tk}` },
    null);
  process.stdout.write(`Validate HTTP: ${vr.s}\n${vr.b.slice(0, 1000)}\n`);

  // Retry SUBMIT
  process.stdout.write('\nRetrying SUBMIT...\n');
  require('dotenv').config({ path: '../inventory-api/inventory-api/.env' });
  const { createBillingCredentialResolver } = require('../inventory-api/inventory-api/src/services/billing-credential-resolver.service');
  const resolver = createBillingCredentialResolver();
  const key = resolver.resolveApiKey('env:BILLING_SANDBOX_M2M_API_KEY');
  const sr = await httpReq('POST',
    '/api/v1/companies/dde91f44-6ceb-4eb7-b322-0139919cc34d/fiscal-documents/SANDBOX/invoices/353a13aa-dd13-4382-8af3-9bb15280fff6/submit',
    { 'X-API-Key': key, 'Content-Type': 'application/json' },
    '{}');
  process.stdout.write(`Submit HTTP: ${sr.s}\n${sr.b.slice(0, 1000)}\n`);
}

main().catch((e) => { process.stderr.write(`ERROR: ${e.message}\n`); process.exit(1); });
