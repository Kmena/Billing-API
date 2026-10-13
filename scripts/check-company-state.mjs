import { readFileSync } from 'fs';
import { PrismaClient } from '@prisma/client';

// Load .env.local
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

const COMPANY_ID = process.env.INVENTORI_SANDBOX_COMPANY_ID;
const TENANT_ID  = process.env.INVENTORI_SANDBOX_TENANT_ID;

console.log(`[checking company: ${COMPANY_ID}  tenant: ${TENANT_ID}]`);

const prisma = new PrismaClient();

async function main() {
  // ── Company
  const company = await prisma.company.findUnique({ where: { id: COMPANY_ID } });
  console.log('\n=== COMPANY ===');
  if (!company) { console.log('NOT FOUND'); } else {
    console.log(JSON.stringify({
      id: company.id,
      tenantId: company.tenantId,
      legalName: company.legalName,
      identificationType: company.identificationType,
      identificationNumber: company.identificationNumber,
      status: company.status,
      haciendaName: company.haciendaName,
      haciendaVerificationStatus: company.haciendaVerificationStatus,
      haciendaVerifiedAt: company.haciendaVerifiedAt,
      haciendaTaxSituation: company.haciendaTaxSituation,
      haciendaMoroso: company.haciendaMoroso,
      haciendaOmiso: company.haciendaOmiso,
    }, null, 2));
  }

  // ── Fiscal Profile
  const profile = await prisma.companyFiscalProfile.findFirst({ where: { companyId: COMPANY_ID } });
  console.log('\n=== FISCAL PROFILE ===');
  if (!profile) { console.log('NOT FOUND'); } else {
    console.log(JSON.stringify({
      id: profile.id,
      economicActivityCode: profile.economicActivityCode,
      defaultEconomicActivityId: profile.defaultEconomicActivityId,
      province: profile.province, canton: profile.canton, district: profile.district,
      email: profile.email,
    }, null, 2));
  }

  // ── Economic Activities
  const activities = await prisma.companyEconomicActivity.findMany({ where: { companyId: COMPANY_ID } });
  console.log('\n=== ECONOMIC ACTIVITIES (' + activities.length + ') ===');
  for (const a of activities) {
    console.log(JSON.stringify({
      id: a.id, code: a.code, description: a.description,
      haciendaStatus: a.haciendaStatus, haciendaKind: a.haciendaKind,
      billingEnabled: a.billingEnabled, verificationSource: a.verificationSource,
      verifiedAt: a.verifiedAt, lastSeenAt: a.lastSeenAt,
    }, null, 2));
  }

  // ── Active Certificate
  const cert = await prisma.fiscalSigningCertificate.findFirst({
    where: { companyId: COMPANY_ID, status: 'ACTIVE' }, orderBy: { createdAt: 'desc' },
  });
  console.log('\n=== ACTIVE CERTIFICATE ===');
  if (!cert) { console.log('NONE'); } else {
    console.log(JSON.stringify({
      id: cert.id, status: cert.status, environment: cert.environment,
      fingerprintSha256: cert.fingerprintSha256,
      extractedIdentityNumber: cert.extractedIdentityNumber,
      extractedIdentityType: cert.extractedIdentityType,
      subjectName: cert.subjectName, validFrom: cert.validFrom, validTo: cert.validTo,
    }, null, 2));
  }

  // ── Hacienda Connection
  const conn = await prisma.haciendaConnection.findFirst({ where: { companyId: COMPANY_ID } });
  console.log('\n=== HACIENDA CONNECTION ===');
  if (!conn) { console.log('NONE'); } else {
    console.log(JSON.stringify({ id: conn.id, environment: conn.environment, status: conn.status, lastValidatedAt: conn.lastValidatedAt }, null, 2));
  }

  // ── Default Issuance Point
  const ip = await prisma.fiscalIssuancePoint.findFirst({
    where: { companyId: COMPANY_ID, isDefault: true },
  });
  console.log('\n=== DEFAULT ISSUANCE POINT ===');
  if (!ip) { console.log('NONE'); } else {
    console.log(JSON.stringify({ id: ip.id, environment: ip.environment, branchCode: ip.branchCode, terminalCode: ip.terminalCode, isDefault: ip.isDefault, active: ip.active }, null, 2));
  }

  // ── Active API Keys
  const apiKeys = await prisma.apiKey.findMany({
    where: { tenantId: TENANT_ID, status: 'ACTIVE' },
    include: { companies: { select: { companyId: true } } },
  });
  console.log('\n=== ACTIVE API KEYS (' + apiKeys.length + ') ===');
  for (const k of apiKeys) {
    console.log(JSON.stringify({
      id: k.id, name: k.name, environment: k.environment,
      keyPrefix: k.keyPrefix, scopes: k.scopes, status: k.status,
      expiresAt: k.expiresAt,
    }, null, 2));
  }
}

main().catch(e => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());
