'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({ log: ['error'] });

const s = (k, v) => (typeof v === 'bigint' ? v.toString() : v);

async function main() {
  // List all API keys (never showing keyHash/raw key, only safe metadata)
  const apiKeys = await prisma.apiKey.findMany({
    select: {
      id: true,
      tenantId: true,
      keyPrefix: true,
      name: true,
      environment: true,
      scopes: true,
      status: true,
      expiresAt: true,
      lastUsedAt: true,
      createdAt: true,
      companies: {
        include: {
          company: {
            select: { id: true, legalName: true, identificationType: true, identificationNumber: true },
          },
        },
      },
    },
  });
  process.stdout.write('=== API KEYS (no raw secrets) ===\n');
  process.stdout.write(JSON.stringify(apiKeys, s, 2) + '\n');

  // Count API keys
  process.stdout.write('Total API keys: ' + apiKeys.length + '\n');
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    process.stderr.write('ERROR: ' + e.message + '\n');
    prisma.$disconnect();
    process.exit(1);
  });
