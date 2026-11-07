import { createHash } from 'node:crypto';
import { readEncryptedM2mKey } from '/app/apps/api/dist/billing/onboarding-routes.js';

const affiliationCompanyId = '136b2e9a-7bc4-4a68-8598-33a8b6daef9a';
const billingCompanyId = '853f67c5-f229-42c1-9f30-8c15b230722c';
const invoiceId = '817f1bd8-0092-4661-9064-e7f69d18b5b6';
const expected = {
  PDF: '729bad376e88897a3364e38a829374686290a6d5d0cb8b3e78a1f67cdfe28317',
  SIGNED_XML: 'e5eaac5796ed75ecc6c018d5462e11048903c32ea8a4c5f14e2f24562205da4f',
  HACIENDA_RESPONSE_XML: 'dc26b7e28ec3d75d95bd105cce2a48f99c1943d5a236e91f315a27ea8015936f',
};
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const key = readEncryptedM2mKey(
  process.env.BILLING_ONBOARDING_M2M_KEY_DIR,
  process.env.BILLING_ONBOARDING_M2M_PRIVATE_KEY_FILE,
  affiliationCompanyId,
);
const base = new URL(`/api/v2/lab/companies/${billingCompanyId}/fiscal-documents/SANDBOX/invoices/${invoiceId}/`,
  process.env.BILLING_ONBOARDING_BASE_URL);
async function get(path) {
  const response = await fetch(new URL(path, base), {
    method: 'GET', headers: { 'X-API-Key': key }, redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`GET ${path}: HTTP ${response.status}`);
  return response;
}
const view = await (await get('fiscal-view')).json();
if (view.id !== invoiceId || view.status !== 'ACCEPTED' ||
    view.consecutive !== '00100001010000000008' || view.environment !== 'STAG' ||
    !view.acceptedAt || view.emailDelivery?.status !== 'DELIVERED')
  throw new Error('SPEC10_FISCAL_VIEW_MISMATCH');
const originals = [];
for (const [type, hash] of Object.entries(expected)) {
  const metadata = { PDF: view.documents?.pdf, SIGNED_XML: view.documents?.signedXml,
    HACIENDA_RESPONSE_XML: view.documents?.haciendaResponse }[type];
  if (metadata?.sha256 !== hash) throw new Error(`SPEC10_METADATA_HASH_MISMATCH:${type}`);
  const response = await get(`artifacts/${type}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (sha(bytes) !== hash || response.headers.get('X-Content-SHA256') !== hash)
    throw new Error(`SPEC10_DOWNLOAD_HASH_MISMATCH:${type}`);
  originals.push(bytes);
}
const packageResponse = await get('package');
const zip = Buffer.from(await packageResponse.arrayBuffer());
if (sha(zip) !== packageResponse.headers.get('X-Content-SHA256'))
  throw new Error('SPEC10_PACKAGE_HASH_MISMATCH');
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
  throw new Error('SPEC10_PACKAGE_CONTENT_MISMATCH');
process.stdout.write(JSON.stringify({ invoiceId, status: view.status, consecutive: view.consecutive,
  acceptedAt: view.acceptedAt, emailDelivery: view.emailDelivery.status,
  hashes: expected, packageSha256: sha(zip), documents: contents.length, readOnly: true }) + '\n');
