import { readFileSync } from 'fs';
import { PrismaClient } from '@prisma/client';

const envFile = readFileSync('.env.local', 'utf8');
for (const line of envFile.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx < 0) continue;
  const key = trimmed.slice(0, eqIdx).trim();
  const val = trimmed.slice(eqIdx + 1).trim();
  if (key && !process.env[key]) process.env[key] = val;
}

const prisma = new PrismaClient();

async function main() {
  const tenants = await prisma.tenant.findMany({ take: 10 });
  console.log('\n=== ALL TENANTS (' + tenants.length + ') ===');
  for (const t of tenants) {
    console.log(JSON.stringify({ id: t.id, name: t.name, slug: t.slug, status: t.status }, null, 2));
  }

  const companies = await prisma.company.findMany({ take: 20 });
  console.log('\n=== ALL COMPANIES (' + companies.length + ') ===');
  for (const c of companies) {
    console.log(JSON.stringify({
      id: c.id,
      tenantId: c.tenantId,
      legalName: c.legalName,
      identificationType: c.identificationType,
      identificationNumber: c.identificationNumber,
      status: c.status,
      haciendaVerificationStatus: c.haciendaVerificationStatus,
    }, null, 2));
  }
}

main().catch(e => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());
