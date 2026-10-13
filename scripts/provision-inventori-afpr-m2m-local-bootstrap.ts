/**
 * Local-only, one-shot Inventori AFPR M2M provisioner.
 *
 * This is an operational bootstrap, not a JWT substitute. It has no HTTP
 * surface and runs only against the verified local development database after
 * an explicit operator authorization. It reuses Billing's API-key domain
 * handlers, persists only the key hash, and records an immutable audit event.
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { URL } from 'node:url';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { PrismaApiKeyRepository } from '../src/modules/api-keys/infrastructure/persistence/prisma-api-key.repository';
import { CreateApiKeyHandler } from '../src/modules/api-keys/application/use-cases/create-api-key/create-api-key.handler';
import { AssignApiKeyCompanyHandler } from '../src/modules/api-keys/application/use-cases/assign-api-key-company/assign-api-key-company.handler';
import { PrismaAuditLogRepository } from '../src/modules/audit/infrastructure/persistence/prisma-audit-log.repository';
import { AuditLog, EventClass } from '../src/modules/audit/domain/entities/audit-log.entity';

const OPERATOR_AUTHORIZATION = 'AUTHORIZE_INVENTORI_AFPR_M2M_LOCAL_BOOTSTRAP';
const REQUIRED_SCOPES = [
  'taxpayers:read',
  'cabys:read',
  'exchange-rates:read',
  'fiscal-onboarding:read',
  'fiscal-onboarding:write',
  'fiscal-credentials:write',
  'fiscal-credentials:validate',
  'invoices:read',
  'invoices:write',
  'tickets:read',
  'tickets:write',
];
const EXPECTED_SCOPES = [...REQUIRED_SCOPES, 'fiscal-deliveries:resend'];
const HANDOFF_PATH = '.secrets/inventori-m2m-afpr-next.env';
const LOCK_PATH = '.secrets/inventori-m2m-afpr-bootstrap.lock';

function loadLocalEnvironment(): Promise<void> {
  if (!existsSync('.env.local')) throw new Error('Missing .env.local local configuration.');
  return readFile('.env.local', 'utf8').then((content) => {
    for (const raw of content.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const separator = line.indexOf('=');
      if (separator < 1) continue;
      const key = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim();
      if (key && !process.env[key]) process.env[key] = value;
    }
  });
}

function requireValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required local configuration: ${name}.`);
  return value;
}

function assertLocalDevelopmentTarget(): void {
  if (process.env.NODE_ENV !== 'development') {
    throw new Error('This bootstrap is restricted to NODE_ENV=development.');
  }
  const database = new URL(requireValue('DATABASE_URL'));
  if (!['localhost', '127.0.0.1', '::1'].includes(database.hostname)) {
    throw new Error('This bootstrap is restricted to a local PostgreSQL host.');
  }
  if (process.env.BILLING_LOCAL_OPERATOR_AUTHORIZATION !== OPERATOR_AUTHORIZATION) {
    throw new Error('Explicit local operator authorization was not supplied.');
  }
}

function sameScopes(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && actual.every((scope) => expected.includes(scope));
}

async function main(): Promise<void> {
  await loadLocalEnvironment();
  assertLocalDevelopmentTarget();

  const tenantId = requireValue('INVENTORI_SANDBOX_TENANT_ID');
  const companyId = requireValue('INVENTORI_SANDBOX_COMPANY_ID');
  const configuredOldKeyId = requireValue('INVENTORI_M2M_API_KEY_ID');

  await mkdir('.secrets', { recursive: true, mode: 0o700 });
  if (existsSync(HANDOFF_PATH))
    throw new Error('Secure NEXT handoff already exists; refusing to overwrite it.');

  let lockHandle: Awaited<ReturnType<typeof open>> | undefined;
  let handoffHandle: Awaited<ReturnType<typeof open>> | undefined;
  let prisma: PrismaService | undefined;
  let createdKey: { id: string; secret: string; keyPrefix: string } | undefined;
  let handoffStored = false;

  try {
    lockHandle = await open(LOCK_PATH, 'wx', 0o600);
    handoffHandle = await open(HANDOFF_PATH, 'wx', 0o600);

    prisma = new PrismaService();
    await prisma.$connect();

    const administrator = await prisma.user.findFirst({
      where: { tenantId, role: 'TENANT_ADMIN', status: 'ACTIVE' },
      select: { id: true, lastLoginAt: true },
    });
    if (!administrator?.lastLoginAt) {
      throw new Error('No active tenant administrator with authentication history is available.');
    }

    const company = await prisma.company.findFirst({
      where: { id: companyId, tenantId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!company)
      throw new Error('Configured Inventori company is not active in the expected tenant.');

    const oldKeyCandidates = await prisma.apiKey.findMany({
      where: {
        tenantId,
        name: 'Inventori SANDBOX M2M',
        status: 'ACTIVE',
        environment: 'TEST',
        companies: { some: { companyId } },
      },
      select: { id: true, scopes: true },
    });
    const matchingOldKeys = oldKeyCandidates.filter((key) =>
      sameScopes(key.scopes, REQUIRED_SCOPES),
    );
    if (matchingOldKeys.length !== 1) {
      throw new Error(
        'Could not identify exactly one active Inventori M2M TEST key with the expected 11 scopes.',
      );
    }
    const oldKey = matchingOldKeys[0];
    const configuredKeyMatchesActiveKey = configuredOldKeyId === oldKey.id;
    if (!configuredKeyMatchesActiveKey) {
      console.log('CONFIGURED_INVENTORI_KEY_REFERENCE_STALE=YES');
    }

    const activeReplacement = await prisma.apiKey.findFirst({
      where: {
        tenantId,
        status: 'ACTIVE',
        name: { startsWith: 'Inventori SANDBOX M2M AFPR replacement' },
      },
      select: { id: true },
    });
    if (activeReplacement)
      throw new Error(
        'An active AFPR replacement key already exists; refusing duplicate provisioning.',
      );

    const repository = new PrismaApiKeyRepository(prisma);
    const createApiKey = new CreateApiKeyHandler(repository);
    const assignCompany = new AssignApiKeyCompanyHandler(prisma);
    const result = await createApiKey.execute({
      tenantId,
      name: `Inventori SANDBOX M2M AFPR replacement ${new Date().toISOString().slice(0, 10)}`,
      environment: 'TEST',
      scopes: EXPECTED_SCOPES,
    });
    createdKey = { id: result.id, secret: result.secret, keyPrefix: result.keyPrefix };

    const binding = await assignCompany.execute({ tenantId, apiKeyId: result.id, companyId });
    if (!binding.created)
      throw new Error('Unexpected pre-existing company binding for a newly created key.');

    await handoffHandle.writeFile(
      [
        '# LOCAL ONLY — pending Inventori switch; gitignored.',
        `INVENTORI_M2M_API_KEY_NEXT=${result.secret}`,
        `INVENTORI_M2M_API_KEY_NEXT_ID=${result.id}`,
        `INVENTORI_M2M_API_KEY_NEXT_PREFIX=${result.keyPrefix}`,
        '',
      ].join('\n'),
      'utf8',
    );
    await handoffHandle.sync();
    handoffStored = true;

    const auditRepository = new PrismaAuditLogRepository(prisma);
    const audit = new AuditLog({
      id: randomUUID(),
      tenantId,
      companyId,
      apiKeyId: result.id,
      actor: `local-operator:${process.env.USERNAME ?? 'unknown'}`,
      action: 'api-key.local-bootstrap-provisioned',
      resource: `ApiKey:${result.id}`,
      eventClass: EventClass.SECURITY,
      metadata: { scopeCount: result.scopes.length, source: 'local-development-bootstrap' },
    });
    await auditRepository.insert(audit);

    const verifiedKey = await prisma.apiKey.findFirst({
      where: { id: result.id, tenantId, status: 'ACTIVE', environment: 'TEST' },
      select: { id: true, scopes: true },
    });
    const verifiedBinding = await prisma.apiKeyCompany.findUnique({
      where: { apiKeyId_companyId: { apiKeyId: result.id, companyId } },
    });
    const verifiedAudit = await prisma.auditLog.findUnique({ where: { id: audit.id } });
    if (
      !verifiedKey ||
      !sameScopes(verifiedKey.scopes, EXPECTED_SCOPES) ||
      !verifiedBinding ||
      !verifiedAudit
    ) {
      throw new Error('Post-provisioning verification failed.');
    }

    console.log('LOCAL_ADMIN_BOOTSTRAP_PROVISIONING_COMPLETE');
    console.log('NEW_KEY_ACTIVE=YES');
    console.log('NEW_KEY_SCOPE_COUNT=12');
    console.log('AFPR_SCOPE_PRESENT=YES');
    console.log(`SECURE_HANDOFF=${HANDOFF_PATH}`);
    console.log('AUDIT_EVENT_CREATED=YES');
  } catch (error) {
    if (createdKey && !handoffStored && prisma) {
      await prisma.apiKey
        .update({
          where: { id: createdKey.id },
          data: { status: 'REVOKED', revokedAt: new Date(), revokedBy: null },
        })
        .catch(() => undefined);
    }
    throw error;
  } finally {
    if (handoffHandle) await handoffHandle.close().catch(() => undefined);
    if (!handoffStored && existsSync(HANDOFF_PATH))
      await unlink(HANDOFF_PATH).catch(() => undefined);
    if (lockHandle) await lockHandle.close().catch(() => undefined);
    if (existsSync(LOCK_PATH)) await unlink(LOCK_PATH).catch(() => undefined);
    if (prisma) await prisma.$disconnect().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(
    `LOCAL_ADMIN_BOOTSTRAP_PROVISIONING_FAILED: ${error instanceof Error ? error.message : 'unknown error'}`,
  );
  process.exitCode = 1;
});
