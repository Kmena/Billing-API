'use strict';
const http = require('http');

function httpReq(method, path, headers, body) {
  return new Promise((resolve, reject) => {
    const opts = { hostname: 'localhost', port: 3000, path, method, headers };
    const req = http.request(opts, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve({ status: res.status, statusCode: res.statusCode, body: d }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function main() {
  // 1. Login to Billing as admin
  const loginBody = JSON.stringify({ tenantId: '25ae538c-b272-407b-83d0-ccc78be3c658', email: 'admin@inventori-sandbox.billing', password: 'Admin@Billing2026!' });
  const loginRes = await httpReq('POST', '/api/v1/auth/login',
    { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(loginBody) },
    loginBody);
  process.stdout.write(`Login HTTP: ${loginRes.statusCode}\n`);
  const loginData = JSON.parse(loginRes.body);
  if (loginRes.statusCode !== 200 && loginRes.statusCode !== 201) {
    process.stdout.write(`Login failed: ${loginRes.body.slice(0, 500)}\n`);
    process.exit(1);
  }
  const token = loginData.accessToken;
  process.stdout.write(`Token: ${token.slice(0, 30)}...\n`);

  // 2. Configure Hacienda connection
  const hBody = JSON.stringify({
    username: 'cpf-02-0753-0251@stag.comprobanteselectronicos.go.cr',
    password: 'c#W+1S_=83ThA#yUi6!v',
  });
  const hRes = await httpReq('PUT',
    '/api/v1/companies/dde91f44-6ceb-4eb7-b322-0139919cc34d/hacienda-connection/SANDBOX',
    {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(hBody),
      'Authorization': `Bearer ${token}`,
    },
    hBody);
  process.stdout.write(`Hacienda connect HTTP: ${hRes.statusCode}\n`);
  process.stdout.write(`${hRes.body.slice(0, 800)}\n`);

  // 3. Get connection status
  const statusRes = await httpReq('GET',
    '/api/v1/companies/dde91f44-6ceb-4eb7-b322-0139919cc34d/hacienda-connection/SANDBOX',
    { 'Authorization': `Bearer ${token}` },
    null);
  process.stdout.write(`Connection status HTTP: ${statusRes.statusCode}\n`);
  process.stdout.write(`${statusRes.body.slice(0, 800)}\n`);
}

main().catch((e) => { process.stderr.write(`ERROR: ${e.message}\n`); process.exit(1); });
