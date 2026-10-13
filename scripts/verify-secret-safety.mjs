import { readFileSync } from 'fs';
import { PrismaClient } from '@prisma/client';

const env = readFileSync('.env.local', 'utf8');
for (const l of env.split('\n')) {
  const t = l.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i < 0) continue;
  const k = t.slice(0, i).trim();
  const v = t.slice(i + 1).trim();
  if (k && !process.env[k]) process.env[k] = v;
}

const COMPANY_ID = process.env.INVENTORI_SANDBOX_COMPANY_ID;
const prisma = new PrismaClient();

async function main() {
  const key = await prisma.apiKey.findFirst({
    where: { keyPrefix: '8c3323eb' },
    select: { id: true, keyPrefix: true, keyHash: true, status: true, scopes: true },
  });
  if (!key) throw new Error('Key not found');

  console.log('\n=== SECRET SAFETY AUDIT ===');
  const rawInDb = key.keyHash.startsWith('bk_');
  console.log(`  keyPrefix:              ${key.keyPrefix}`);
  console.log(`  keyHash algorithm:      ${key.keyHash.startsWith('$argon2id') ? 'argon2id ✅' : 'UNKNOWN ⚠️'}`);
  console.log(`  raw key in DB:          ${rawInDb ? '❌ YES — PROBLEM' : 'NO — safe ✅'}`);
  console.log(`  keyHash[:20]:           ${key.keyHash.slice(0, 20)}...`);

  // Check ApiKeyCompany binding
  const binding = await prisma.apiKeyCompany.findUnique({
    where: { apiKeyId_companyId: { apiKeyId: key.id, companyId: COMPANY_ID } },
  });
  console.log('\n=== BINDING STATE ===');
  console.log(`  binding exists:         ${binding ? 'YES ✅' : 'NO ❌'}`);
  console.log(`  apiKeyId:               ${binding?.apiKeyId ?? 'N/A'}`);
  console.log(`  companyId:              ${binding?.companyId ?? 'N/A'}`);

  // Count all bindings for this key
  const allBindings = await prisma.apiKeyCompany.findMany({ where: { apiKeyId: key.id } });
  console.log(`  total bindings for key: ${allBindings.length} (expected: 1 — only target company)`);
  for (const b of allBindings) {
    const match = b.companyId === COMPANY_ID ? '✅ correct' : '❌ UNEXPECTED';
    console.log(`    companyId: ${b.companyId} ${match}`);
  }

  // Final result
  const isClean = !rawInDb && binding && allBindings.length === 1;
  console.log(`\n=== RESULT: ${isClean ? 'PASS ✅' : 'FAIL ❌'} ===`);
}

main()
  .catch(e => { console.error('[ERROR]', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
