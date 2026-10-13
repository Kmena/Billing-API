'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

process.stdout.write('DATABASE_URL prefix: ' + (process.env.DATABASE_URL || '').slice(0, 50) + '\n');

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({ log: ['error'] });

const s = (k, v) => (typeof v === 'bigint' ? v.toString() : v);

async function main() {
  const tenants = await prisma.tenant.findMany();
  process.stdout.write('=== TENANTS ===\n');
  process.stdout.write(JSON.stringify(tenants, s, 2) + '\n');

  const companies = await prisma.company.findMany({
    include: {
      authorizedApiKeys: {
        include: {
          apiKey: {
            select: {
              id: true,
              keyPrefix: true,
              name: true,
              environment: true,
              scopes: true,
              status: true,
              createdAt: true,
            },
          },
        },
      },
    },
  });
  process.stdout.write('=== COMPANIES ===\n');
  process.stdout.write(JSON.stringify(companies, s, 2) + '\n');
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    process.stderr.write('ERROR: ' + e.message + '\n');
    prisma.$disconnect();
    process.exit(1);
  });
