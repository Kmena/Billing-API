import * as argon2 from 'argon2';
import { randomUUID } from 'crypto';
// Administrative infrastructure script needs Prisma's transaction isolation enum.
// eslint-disable-next-line no-restricted-imports
import { Prisma } from '@prisma/client';
import { PrismaService } from '../src/infrastructure/database/prisma.service';

// Local SPEC-09 SANDBOX repair for the previously exposed synthetic admin
// credential. Passwords arrive on stdin only and never enter arguments or logs.
async function main() {
  const [tenantId, adminEmail, flag] = process.argv.slice(2);
  if (
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(tenantId ?? '') ||
    !adminEmail ||
    flag !== '--persistent-sandbox' ||
    process.argv.length !== 5
  )
    throw new Error('SPEC09_ADMIN_ROTATION_ARGUMENT_GUARD');
  if (
    process.env.NODE_ENV !== 'test' ||
    process.env.SPEC09_SANDBOX_MARKER !== 'billing-spec09-synthetic-v1' ||
    process.env.BILLING_SPEC09_PERSISTENT_SANDBOX !== 'true' ||
    process.env.USE_REAL_HACIENDA !== 'false' ||
    process.env.FISCAL_WORKER_ENABLE_IN_TESTS !== 'false' ||
    process.env.SPEC09_ADMIN_ISOLATED_TEST
  )
    throw new Error('SPEC09_ADMIN_ROTATION_ENV_GUARD');
  const target = new URL(process.env.DATABASE_URL ?? '');
  if (
    target.protocol !== 'postgresql:' ||
    target.hostname !== '127.0.0.1' ||
    target.port !== '55439' ||
    target.pathname !== '/billing_sandbox' ||
    target.username !== 'billing_sandbox'
  )
    throw new Error('SPEC09_ADMIN_ROTATION_DATABASE_GUARD');
  const input = await new Promise<string>((resolve, reject) => {
    let value = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      value += chunk;
      if (value.length > 256) reject(new Error('SPEC09_ADMIN_ROTATION_INPUT_GUARD'));
    });
    process.stdin.on('end', () => resolve(value));
    process.stdin.on('error', reject);
  });
  const parts = input.split(/\r?\n/);
  const [previous, replacement] = parts;
  if (
    parts.length < 2 ||
    parts.slice(2).some(Boolean) ||
    !previous ||
    !/^[A-Za-z0-9]{48}$/.test(replacement ?? '') ||
    previous === replacement
  )
    throw new Error('SPEC09_ADMIN_ROTATION_INPUT_GUARD');
  const db = new PrismaService({ datasources: { db: { url: target.toString() } } });
  try {
    await db.$connect();
    const [tenants, companies, admins] = await Promise.all([
      db.tenant.findMany({ select: { id: true, slug: true } }),
      db.company.count(),
      db.user.findMany({
        where: { tenantId, role: 'TENANT_ADMIN', status: 'ACTIVE' },
        select: { id: true, email: true, passwordHash: true },
      }),
    ]);
    if (
      tenants.length !== 1 ||
      tenants[0].id !== tenantId ||
      tenants[0].slug !== 'spec09-sandbox-synthetic' ||
      companies !== 1 ||
      admins.length !== 1 ||
      admins[0].email !== adminEmail ||
      !(await argon2.verify(admins[0].passwordHash, previous))
    )
      throw new Error('SPEC09_ADMIN_ROTATION_AUTH_GUARD');
    const hash = await argon2.hash(replacement);
    await db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`spec09-admin:${tenantId}`}, 0))`;
        const changed = await tx.user.updateMany({
          where: {
            id: admins[0].id,
            tenantId,
            role: 'TENANT_ADMIN',
            status: 'ACTIVE',
            passwordHash: admins[0].passwordHash,
          },
          data: { passwordHash: hash },
        });
        if (changed.count !== 1) throw new Error('SPEC09_ADMIN_ROTATION_CONCURRENT_CHANGE');
        await tx.refreshToken.updateMany({
          where: { userId: admins[0].id, used: false },
          data: { used: true },
        });
        await tx.auditLog.create({
          data: {
            id: randomUUID(),
            tenantId,
            actor: admins[0].id,
            action: 'spec09.sandbox.admin.password.rotated',
            resource: `User:${admins[0].id}`,
            eventClass: 'SECURITY',
            metadata: { method: 'local-admin-repair' },
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    const updated = await db.user.findUnique({
      where: { id: admins[0].id },
      select: { passwordHash: true },
    });
    if (!updated || !(await argon2.verify(updated.passwordHash, replacement)))
      throw new Error('SPEC09_ADMIN_ROTATION_POSTCHECK_FAILED');
    process.stdout.write('SPEC09_ADMIN_PASSWORD_ROTATED\n');
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  const code =
    error instanceof Error && /^SPEC09_[A-Z0-9_]+$/.test(error.message)
      ? error.message
      : 'SPEC09_ADMIN_ROTATION_FAILED';
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
});
