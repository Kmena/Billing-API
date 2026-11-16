// Run inside either Billing image with --network none. Uses a fake token and a loopback server.
const http = require('node:http');
const axios = require('/app/node_modules/axios');
const { HttpService } = require('/app/node_modules/@nestjs/axios');
const { HaciendaRecepcionAdapter } = require('/app/dist/src/modules/fiscal-documents/infrastructure/submission/hacienda-recepcion.adapter.js');

const clave = '50601012500310112345600100001010000000001100000001';
const calls = [];
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    const authorization = req.rawHeaders.flatMap((header, index) =>
      index % 2 === 0 && header.toLowerCase() === 'authorization' ? [req.rawHeaders[index + 1]] : []);
    const data = req.method === 'POST' ? JSON.parse(body) : null;
    calls.push({ method: req.method, path: req.url,
      authorizationCount: authorization.length,
      authorizationExact: authorization[0] === 'bearer fake.jwt.token',
      contentType: req.headers['content-type'] ?? null, accept: req.headers.accept ?? null,
      bodyKeys: data ? Object.keys(data).sort() : [],
      claveMatches: data ? data.clave === clave : null,
      issuerScalar: data ? typeof data.emisor.tipoIdentificacion === 'string' : null,
      xmlBase64Matches: data ? data.comprobanteXml === Buffer.from('<FacturaElectronica/>').toString('base64') : null });
    res.writeHead(req.method === 'POST' ? 202 : 200, { 'Content-Type': 'application/json' });
    res.end(req.method === 'POST' ? '{}' : JSON.stringify({ clave, 'ind-estado': 'procesando' }));
  });
});
async function main() {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/recepcion/v1/`;
  const adapter = new HaciendaRecepcionAdapter({ get: () => ({ sandboxBaseUrl: baseUrl,
    productionBaseUrl: 'https://127.0.0.1:9/', timeoutMs: 5000 }) },
  new HttpService(axios.create({ proxy: false })));
  const submitted = await adapter.submitSignedDocument({ environment: 'SANDBOX',
    documentType: 'INVOICE', accessToken: 'fake.jwt.token', clave,
    consecutive: '00100001010000000008', issueDate: new Date('2026-11-06T20:50:00.000Z'),
    issuer: { identification: { type: '02', number: '3101123456' } },
    signedXml: Buffer.from('<FacturaElectronica/>') });
  const queried = await adapter.queryStatusByClave({ environment: 'SANDBOX',
    accessToken: 'fake.jwt.token', clave });
  if (calls.length !== 2 || calls.some((call) => !call.authorizationExact || call.authorizationCount !== 1))
    throw new Error('WIRE_CONTRACT_MISMATCH');
  console.log(JSON.stringify({ calls, submitStatus: submitted.nextStatus, queryStatus: queried.nextStatus,
    node: process.version, axios: require('/app/node_modules/axios/package.json').version }));
}
main().catch((error) => { console.error(`LOCAL_WIRE_DIAGNOSTIC_FAILED=${error.name}`); process.exitCode = 1; })
  .finally(() => server.close());
