/**
 * Billing Database Seed Script
 * Creates the first Tenant and TENANT_ADMIN user if the database is empty.
 *
 * Usage: npm run db:seed
 * Environment variables: DATABASE_URL, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD
 *
 * A-004: Seed script is the approved mechanism for first admin user creation.
 */
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

// Load .env.local so the script works without a pre-set DATABASE_URL in the shell.
// Shell env vars always take priority (no override). Never logs values.
function loadLocalEnv(): void {
  const envPath = path.join(process.cwd(), '.env.local');
  try {
    if (!fs.existsSync(envPath)) return;
    for (const raw of fs.readFileSync(envPath, 'utf-8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 1) continue;
      const key = line.slice(0, eq).trim();
      const val = line.slice(eq + 1).trim();
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {
    // Silently ignore — user may not have .env.local yet
  }
}
loadLocalEnv();
import * as argon2 from 'argon2';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const tenantCount = await prisma.tenant.count();

  if (tenantCount > 0) {
    // eslint-disable-next-line no-console
    console.log('Seed: Database already has tenants. Skipping seed.');
    return;
  }

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@billing.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';
  const tenantName = process.env.SEED_TENANT_NAME ?? 'Default Tenant';

  // eslint-disable-next-line no-console
  console.log('Seed: Creating first tenant and admin user...');

  const tenantId = randomUUID();
  await prisma.tenant.create({
    data: {
      id: tenantId,
      name: tenantName,
      slug: tenantName
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, '-'),
      status: 'ACTIVE',
      plan: 'TRIAL',
    },
  });

  const passwordHash = await argon2.hash(adminPassword, { type: argon2.argon2id });
  await prisma.user.create({
    data: {
      id: randomUUID(),
      tenantId,
      email: adminEmail,
      passwordHash,
      firstName: 'System',
      lastName: 'Admin',
      role: 'TENANT_ADMIN',
      status: 'ACTIVE',
    },
  });

  // eslint-disable-next-line no-console
  console.log(`Seed: Created tenant '${tenantName}' (${tenantId})`);
  // eslint-disable-next-line no-console
  console.log(`Seed: Created admin user '${adminEmail}'`);
  // eslint-disable-next-line no-console
  console.log('Seed: IMPORTANT — Change the admin password after first login!');
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
