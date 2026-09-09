/**
 * Billing Database Seed Script
 * Creates the first Tenant and TENANT_ADMIN user if the database is empty.
 *
 * Usage: npm run db:seed
 * Environment variables: DATABASE_URL, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD
 *
 * A-004: Seed script is the approved mechanism for first admin user creation.
 */
import { PrismaClient } from '@prisma/client';
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
