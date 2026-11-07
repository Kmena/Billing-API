import { createHash, randomUUID } from 'node:crypto';
import express from '/app/node_modules/express/index.js';
import { PrismaClient } from '/app/node_modules/@prisma/client/default.js';
import { createBillingDocumentsRouter } from '/app/apps/api/dist/billing/documents.js';
import { readConfig } from '/app/apps/api/dist/config.js';

const userId = 'a10124f4-7548-4ade-8c5f-6e08ff594c5f';
const paymentId = '494c6cad-641d-43ae-9f9a-debc57867339';
const invoiceId = '817f1bd8-0092-4661-9064-e7f69d18b5b6';
const expected = {
  pdf: '729bad376e88897a3364e38a829374686290a6d5d0cb8b3e78a1f67cdfe28317',
  'signed-xml': 'e5eaac5796ed75ecc6c018d5462e11048903c32ea8a4c5f14e2f24562205da4f',
  'hacienda-response': 'dc26b7e28ec3d75d95bd105cce2a48f99c1943d5a236e91f315a27ea8015936f',
};
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const db = new PrismaClient();
const config = readConfig();
let server;
try {
  const user = await db.user.findUnique({ where: { id: userId }, include: {
    role: { include: { permissions: { include: { permission: true } } } },
  } });
  if (!user || user.status !== 'ACTIVE' ||
      !user.role.permissions.some((item) => item.permission.code === 'billing.operations.view'))
    throw new Error('SPEC10_USER_PERMISSION_MISSING');
  const actor = { id: user.id, companyId: user.companyId,
    permissions: user.role.permissions.map((item) => item.permission.code) };
  let currentActor = actor;
  const app = express();
  app.use((_, res, next) => { res.locals.actor = currentActor; res.locals.requestId = randomUUID(); next(); });
  app.use('/documents', createBillingDocumentsRouter(db, config));
  app.use((error, _request, response, _next) => response.status(error.status ?? 500).json({ code: error.code ?? 'ERROR' }));
  server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function get(path, expectedStatus = 200) {
    const response = await fetch(`${origin}/documents/${paymentId}/${path}`, {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    if (response.status !== expectedStatus)
      throw new Error(`SPEC10_AFFILIATIONS_GET_FAILED:${path}:${response.status}`);
    return response;
  }
  const status = await (await get('fiscal-status')).json();
  if (status.invoice?.id !== invoiceId || status.invoice.status !== 'ACCEPTED' ||
      status.invoice.consecutive !== '00100001010000000008' ||
      status.invoice.environment !== 'STAG' || !status.invoice.acceptedAt ||
      status.invoice.emailDelivery?.status !== 'DELIVERED' ||
      !Object.values(status.invoice.documents).every(Boolean))
    throw new Error('SPEC10_AFFILIATIONS_STATUS_MISMATCH');
  const originals = [];
  for (const [kind, hash] of Object.entries(expected)) {
    const response = await get(`download/${kind}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (sha(bytes) !== hash || response.headers.get('X-Content-SHA256') !== hash)
      throw new Error(`SPEC10_AFFILIATIONS_HASH_MISMATCH:${kind}`);
    originals.push(bytes);
  }
  const packageResponse = await get('download/package');
  const zip = Buffer.from(await packageResponse.arrayBuffer());
  if (sha(zip) !== packageResponse.headers.get('X-Content-SHA256'))
    throw new Error('SPEC10_AFFILIATIONS_PACKAGE_HASH_MISMATCH');
  let offset = 0;
  const contents = [];
  while (offset + 30 <= zip.length && zip.readUInt32LE(offset) === 0x04034b50) {
    if (zip.readUInt16LE(offset + 8) !== 0) throw new Error('SPEC10_ZIP_COMPRESSION_UNEXPECTED');
    const size = zip.readUInt32LE(offset + 18);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    const start = offset + 30 + nameLength + extraLength;
    contents.push(zip.subarray(start, start + size));
    offset = start + size;
  }
  if (contents.length !== 3 || contents.some((bytes, index) => !bytes.equals(originals[index])))
    throw new Error('SPEC10_AFFILIATIONS_PACKAGE_CONTENT_MISMATCH');
  currentActor = { ...actor, permissions: [] };
  await get('fiscal-status', 403);
  currentActor = { ...actor, companyId: randomUUID() };
  await get('fiscal-status', 404);
  process.stdout.write(JSON.stringify({ invoiceId, paymentId, status: status.invoice.status,
    acceptedAt: status.invoice.acceptedAt, emailDelivery: status.invoice.emailDelivery.status,
    hashes: expected, packageSha256: sha(zip), permissionDenied: 403, otherCompany: 404,
    documents: contents.length }) + '\n');
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  await db.$disconnect();
}
