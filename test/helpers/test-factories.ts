/**
 * Test factories for creating test data in E2E tests.
 * Used to set up fixtures quickly without going through HTTP endpoints.
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes, randomUUID } from 'crypto';

export interface TestTenant {
  id: string;
  name: string;
  slug: string;
}

export interface TestUser {
  id: string;
  tenantId: string;
  email: string;
  password: string;
  role: string;
}

export async function createTestTenant(
  prisma: PrismaClient,
  override: Partial<{ name: string; slug: string }> = {},
): Promise<TestTenant> {
  const id = randomUUID();
  const name = override.name ?? `Test Tenant ${id.substring(0, 8)}`;
  const slug =
    override.slug ??
    name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-');

  await prisma.tenant.create({
    data: { id, name, slug, status: 'ACTIVE', plan: 'TRIAL' },
  });

  return { id, name, slug };
}

export async function createTestUser(
  prisma: PrismaClient,
  tenantId: string,
  override: Partial<{ email: string; password: string; role: string }> = {},
): Promise<TestUser> {
  const id = randomUUID();
  const password = override.password ?? 'TestPassword123!';
  const email = override.email ?? `test-${id.substring(0, 8)}@example.com`;
  const role = override.role ?? 'TENANT_ADMIN';
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  await prisma.user.create({
    data: {
      id,
      tenantId,
      email,
      passwordHash,
      role: role as 'TENANT_ADMIN' | 'MEMBER' | 'READ_ONLY',
      status: 'ACTIVE',
    },
  });

  return { id, tenantId, email, password, role };
}

export async function createTestApiKey(prisma: PrismaClient, scopes: string[]): Promise<string> {
  const tenant = await createTestTenant(prisma);
  const keyPrefix = randomBytes(4).toString('hex');
  const secret = 'bk_test_' + keyPrefix + '_' + randomBytes(16).toString('hex');
  const keyHash = await argon2.hash(secret, { type: argon2.argon2id });

  await prisma.apiKey.create({
    data: {
      id: randomUUID(),
      tenantId: tenant.id,
      name: 'E2E validation key',
      environment: 'TEST',
      keyPrefix,
      keyHash,
      scopes,
      status: 'ACTIVE',
    },
  });
  return secret;
}
