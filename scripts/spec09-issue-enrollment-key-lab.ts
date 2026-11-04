import * as argon2 from 'argon2';
import { createPublicKey, publicEncrypt, randomBytes, randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { StringDecoder } from 'string_decoder';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import {
  AFFILIATIONS_ENROLLMENT_V2_PROFILE,
  AFFILIATIONS_ENROLLMENT_V2_SCOPES,
  AFFILIATIONS_FISCAL_DETAILS_V2_SCOPES,
  AFFILIATIONS_MEMBERSHIP_STAG_V2_SCOPES,
} from '../src/modules/fiscal-consumers/domain/consumer-v2.policy';
import {
  assertDisposableDatabaseMarker,
  installGuardedTestDatabaseEnvironment,
} from '../test/helpers/test-database-safety';

/**
 * Billing administrator issues one company/SANDBOX grant once. Thereafter
 * Afiliaciones initiates onboarding by API without another Billing action.
 */
async function assertPersistentSandboxTarget(
  prisma: PrismaService,
  tenantId: string,
  companyId: string,
  affiliationsCompanyId: string,
  isolatedTest: boolean,
) {
  const [tenant, company, documents, mapped, activeKeys] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { slug: true, status: true } }),
    prisma.company.findUnique({
      where: { id: companyId },
      select: { tenantId: true, legalName: true, status: true },
    }),
    prisma.fiscalDocument.findMany({
      where: { tenantId, companyId },
      select: { companyId: true, environment: true, type: true, originAssociationId: true },
    }),
    prisma.fiscalConsumerCompany.findFirst({
      where: {
        tenantId,
        companyId,
        externalCompanyKey: `affiliations:${affiliationsCompanyId}`,
        consumer: { provider: 'AFFILIATIONS', externalConsumerKey: 'afiliaciones-spec09' },
      },
      include: { associations: true },
    }),
    prisma.apiKey.findMany({
      where: {
        tenantId,
        name: `affiliations-enrollment:affiliations:${affiliationsCompanyId}`,
        status: 'ACTIVE',
        expiresAt: { gt: new Date() },
      },
      select: {
        environment: true,
        integrationProfile: true,
        scopes: true,
        companies: { select: { companyId: true } },
        consumerKeyBinding: { select: { associationId: true } },
      },
    }),
  ]);
  const association = mapped?.associations.filter(
    (row) => row.environment === 'SANDBOX' && row.status === 'ACTIVE',
  );
  const allowedScopes = new Set<string>([
    ...AFFILIATIONS_ENROLLMENT_V2_SCOPES,
    ...AFFILIATIONS_FISCAL_DETAILS_V2_SCOPES,
    ...AFFILIATIONS_MEMBERSHIP_STAG_V2_SCOPES,
  ]);
  if (
    tenant?.slug !== 'spec09-sandbox-synthetic' ||
    tenant.status !== 'ACTIVE' ||
    company?.tenantId !== tenantId ||
    company.legalName !== 'SPEC-09 EMISOR DEMO' ||
    company.status !== 'ACTIVE' ||
    documents.some(
      (document) =>
        document.companyId !== companyId ||
        document.environment !== 'SANDBOX' ||
        document.type !== 'INVOICE' ||
        document.originAssociationId !== association?.[0]?.id,
    ) ||
    association?.length !== 1 ||
    mapped?.associations.length !== 1 ||
    activeKeys.length < 1 ||
    activeKeys.length > 2 ||
    activeKeys.some(
      (key) =>
        key.environment !== 'TEST' ||
        key.integrationProfile !== AFFILIATIONS_ENROLLMENT_V2_PROFILE ||
        key.companies.length !== 1 ||
        key.companies[0].companyId !== companyId ||
        key.consumerKeyBinding?.associationId !== association[0].id ||
        key.scopes.some((scope) => !allowedScopes.has(scope)),
    )
  )
    throw new Error('SPEC09_PERSISTENT_SANDBOX_DATA_GUARD');
  if (!isolatedTest) {
    const [tenants, companies] = await Promise.all([prisma.tenant.count(), prisma.company.count()]);
    if (tenants !== 1 || companies !== 1) throw new Error('SPEC09_PERSISTENT_SANDBOX_DATA_GUARD');
  }
}

async function main() {
  const [tenantId, companyId, affiliationsCompanyId, adminEmail, ...rawOptions] =
    process.argv.slice(2);
  const persistentSandbox = rawOptions[0] === '--persistent-sandbox';
  const options = persistentSandbox ? rawOptions.slice(1) : rawOptions;
  const rotate = options.includes('--rotate');
  const membershipStag = options.includes('--membership-stag');
  const revokeAt = options.indexOf('--revoke-key');
  const abortAt = options.indexOf('--abort-rotation');
  const outputAt = options.indexOf('--output-file');
  const recipientAt = options.indexOf('--recipient-public-key');
  const revokeKeyId =
    revokeAt >= 0 ? options[revokeAt + 1] : abortAt >= 0 ? options[abortAt + 1] : undefined;
  const outputPath = outputAt >= 0 ? options[outputAt + 1] : undefined;
  const recipientPath = recipientAt >= 0 ? options[recipientAt + 1] : undefined;
  const expectedOptions = rotate
    ? [
        '--rotate',
        ...(membershipStag ? ['--membership-stag'] : []),
        '--output-file',
        outputPath,
        '--recipient-public-key',
        recipientPath,
      ]
    : revokeAt >= 0
      ? ['--revoke-key', revokeKeyId]
      : abortAt >= 0
        ? ['--abort-rotation', revokeKeyId]
        : ['--output-file', outputPath, '--recipient-public-key', recipientPath];
  const uuid = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;
  if (
    ![tenantId, companyId, affiliationsCompanyId].every((value) => uuid.test(value ?? '')) ||
    !adminEmail ||
    (membershipStag && !rotate) ||
    options.length !== expectedOptions.length ||
    options.some((value, index) => value !== expectedOptions[index]) ||
    (revokeAt >= 0 || abortAt >= 0
      ? !uuid.test(revokeKeyId ?? '')
      : !outputPath ||
        !path.isAbsolute(outputPath) ||
        !recipientPath ||
        !path.isAbsolute(recipientPath))
  )
    throw new Error(
      'Usage: spec09-issue-enrollment-key-lab <tenantId> <billingCompanyId> <affiliationsCompanyId> <billingAdminEmail> [--persistent-sandbox] [--rotate [--membership-stag]] --output-file <absolute-encrypted-new-file> --recipient-public-key <absolute-public-key-file> | --revoke-key <oldKeyId> | --abort-rotation <newKeyId> (password on hidden TTY or stdin)',
    );
  let disposableTarget = !persistentSandbox;
  let databaseUrl: string;
  if (persistentSandbox) {
    if (
      process.env.NODE_ENV !== 'test' ||
      process.env.SPEC09_SANDBOX_MARKER !== 'billing-spec09-synthetic-v1' ||
      process.env.BILLING_SPEC09_PERSISTENT_SANDBOX !== 'true' ||
      process.env.USE_REAL_HACIENDA !== 'false' ||
      process.env.FISCAL_WORKER_ENABLE_IN_TESTS !== 'false'
    )
      throw new Error('SPEC09_PERSISTENT_SANDBOX_ENV_GUARD');
    if (process.env.SPEC09_ADMIN_ISOLATED_TEST === '1') {
      databaseUrl = installGuardedTestDatabaseEnvironment().databaseUrl;
      disposableTarget = true;
    } else {
      const target = new URL(process.env.DATABASE_URL ?? '');
      if (
        target.protocol !== 'postgresql:' ||
        target.hostname !== '127.0.0.1' ||
        target.port !== '55439' ||
        target.pathname !== '/billing_sandbox' ||
        target.username !== 'billing_sandbox'
      )
        throw new Error('SPEC09_PERSISTENT_SANDBOX_DATABASE_GUARD');
      databaseUrl = target.toString();
    }
  } else databaseUrl = installGuardedTestDatabaseEnvironment().databaseUrl;
  const prisma = new PrismaService({ datasources: { db: { url: databaseUrl } } });
  try {
    await prisma.$connect();
    if (disposableTarget) await assertDisposableDatabaseMarker(prisma);
    if (persistentSandbox)
      await assertPersistentSandboxTarget(
        prisma,
        tenantId!,
        companyId!,
        affiliationsCompanyId!,
        process.env.SPEC09_ADMIN_ISOLATED_TEST === '1',
      );
    const password = await new Promise<string>((resolve, reject) => {
      if (process.stdin.isTTY) {
        const input = process.stdin;
        if (!input.setRawMode) return reject(new Error('BILLING_ADMIN_SECURE_INPUT_UNAVAILABLE'));
        let value = '';
        const decoder = new StringDecoder('utf8');
        const cleanup = () => {
          input.off('data', onData);
          input.setRawMode(false);
          input.pause();
          process.stderr.write('\n');
        };
        const onData = (chunk: Buffer) => {
          for (const byte of chunk) {
            if (byte === 3) {
              cleanup();
              return reject(new Error('BILLING_ADMIN_INPUT_CANCELLED'));
            }
            if (byte === 10 || byte === 13) {
              cleanup();
              return resolve(value);
            }
            if (byte === 8 || byte === 127) value = Array.from(value).slice(0, -1).join('');
            else if (byte >= 32) value += decoder.write(Buffer.from([byte]));
            if (value.length > 1024) {
              cleanup();
              return reject(new Error('BILLING_ADMIN_INPUT_TOO_LONG'));
            }
          }
        };
        process.stderr.write('Billing administrator password: ');
        input.setRawMode(true);
        input.resume();
        input.on('data', onData);
        return;
      }
      let input = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => {
        input += chunk;
        if (input.length > 1024) reject(new Error('Administrator input too long'));
      });
      process.stdin.on('end', () => resolve(input.replace(/\r?\n$/, '')));
      process.stdin.on('error', reject);
    });
    const admin = await prisma.user.findFirst({
      where: { tenantId, email: adminEmail, role: 'TENANT_ADMIN', status: 'ACTIVE' },
      select: { id: true, passwordHash: true },
    });
    if (!admin || !(await argon2.verify(admin.passwordHash, password)))
      throw new Error('BILLING_ADMIN_AUTHENTICATION_FAILED');
    const name = `affiliations-enrollment:affiliations:${affiliationsCompanyId}`;
    if (revokeKeyId) {
      const result = await prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${name}, 0))`;
          const currentAdmin = await tx.user.findFirst({
            where: { id: admin.id, tenantId, role: 'TENANT_ADMIN', status: 'ACTIVE' },
            select: { id: true, passwordHash: true },
          });
          if (!currentAdmin || !(await argon2.verify(currentAdmin.passwordHash, password)))
            throw new Error('BILLING_ADMIN_AUTHENTICATION_FAILED');
          const keys = await tx.apiKey.findMany({
            where: {
              tenantId,
              name,
              integrationProfile: AFFILIATIONS_ENROLLMENT_V2_PROFILE,
              status: 'ACTIVE',
              expiresAt: { gt: new Date() },
              companies: { some: { companyId } },
            },
            orderBy: { createdAt: 'desc' },
            select: { id: true },
          });
          if (
            keys.length !== 2 ||
            (abortAt >= 0 ? keys[0].id !== revokeKeyId : keys[0].id === revokeKeyId) ||
            !keys.some((key) => key.id === revokeKeyId)
          )
            throw new Error('ENROLLMENT_CUTOVER_NOT_VERIFIED');
          await tx.apiKey.update({
            where: { id: revokeKeyId },
            data: { status: 'REVOKED', revokedAt: new Date(), revokedBy: admin.id },
          });
          await tx.auditLog.create({
            data: {
              id: randomUUID(),
              tenantId,
              companyId,
              apiKeyId: revokeKeyId,
              actor: admin.id,
              action:
                abortAt >= 0
                  ? 'onboarding-v2.enrollment.grant.aborted'
                  : 'onboarding-v2.enrollment.grant.revoked',
              eventClass: 'SECURITY',
              resource: `ApiKey:${revokeKeyId}`,
              metadata: {
                environment: 'SANDBOX',
                externalCompanyKey: `affiliations:${affiliationsCompanyId}`,
              } as Prisma.JsonObject,
            },
          });
          return { revokedKeyId: revokeKeyId, remainingActiveKeys: keys.length - 1 };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      process.stdout.write(JSON.stringify(result) + '\n');
      return;
    }
    const prefix = randomBytes(4).toString('hex');
    const raw = `bk_test_${prefix}_${randomBytes(16).toString('hex')}`;
    const hash = await argon2.hash(raw);
    const keyId = randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 86_400_000);
    const recipient = createPublicKey(await fs.readFile(recipientPath!));
    if (
      recipient.asymmetricKeyType !== 'rsa' ||
      (recipient.asymmetricKeyDetails?.modulusLength ?? 0) < 2048
    )
      throw new Error('ENROLLMENT_RECIPIENT_KEY_INVALID');
    const ciphertext = publicEncrypt(
      { key: recipient, oaepHash: 'sha256' },
      Buffer.from(raw, 'utf8'),
    ).toString('base64');
    const relativeOutput = path.relative(process.cwd(), outputPath!);
    if (!relativeOutput.startsWith('..') && !path.isAbsolute(relativeOutput))
      throw new Error('ENROLLMENT_OUTPUT_MUST_BE_OUTSIDE_REPOSITORY');
    const output = await fs.open(outputPath!, 'wx', 0o600);
    let committed = false;
    try {
      try {
        await output.writeFile(
          JSON.stringify({
            keyId,
            // The envelope is consumed by Afiliaciones and indexed by its own company ID.
            // Billing's issuer company remains bound to the API key in the database.
            companyId: affiliationsCompanyId,
            environment: 'SANDBOX',
            expiresAt: expiresAt.toISOString(),
            version: 1,
            algorithm: 'RSA-OAEP-SHA256',
            ciphertext,
          }) + '\n',
        );
        await output.sync();
      } finally {
        await output.close();
      }
      const issued = await prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${name}, 0))`;
          const currentAdmin = await tx.user.findFirst({
            where: { id: admin.id, tenantId, role: 'TENANT_ADMIN', status: 'ACTIVE' },
            select: { id: true, passwordHash: true },
          });
          if (!currentAdmin || !(await argon2.verify(currentAdmin.passwordHash, password)))
            throw new Error('BILLING_ADMIN_AUTHENTICATION_FAILED');
          const company = await tx.company.findFirst({
            where: { id: companyId, tenantId, status: 'ACTIVE' },
            select: { id: true },
          });
          if (!company) throw new Error('ENROLLMENT_COMPANY_NOT_FOUND');
          const active = await tx.apiKey.findMany({
            where: {
              tenantId,
              name,
              integrationProfile: AFFILIATIONS_ENROLLMENT_V2_PROFILE,
              status: 'ACTIVE',
              expiresAt: { gt: new Date() },
            },
          });
          if (active.length && !rotate) throw new Error('ENROLLMENT_GRANT_ALREADY_EXISTS');
          if (active.length > 1 || (rotate && active.length !== 1))
            throw new Error('ENROLLMENT_ROTATION_CUTOVER_REQUIRED');
          const mapped = await tx.fiscalConsumerCompany.findFirst({
            where: {
              tenantId,
              externalCompanyKey: `affiliations:${affiliationsCompanyId}`,
              consumer: { provider: 'AFFILIATIONS', externalConsumerKey: 'afiliaciones-spec09' },
            },
            include: { associations: true },
          });
          if (mapped && mapped.companyId !== companyId)
            throw new Error('ENROLLMENT_COMPANY_REMAP_FORBIDDEN');
          const association = mapped?.associations.find((row) => row.environment === 'SANDBOX');
          if (association && association.status !== 'ACTIVE')
            throw new Error('ENROLLMENT_PENDING_RECOVERY');
          await tx.apiKey.create({
            data: {
              id: keyId,
              tenantId,
              name,
              environment: 'TEST',
              keyPrefix: prefix,
              keyHash: hash,
              scopes: [
                ...AFFILIATIONS_ENROLLMENT_V2_SCOPES,
                ...AFFILIATIONS_FISCAL_DETAILS_V2_SCOPES,
                ...(membershipStag ? AFFILIATIONS_MEMBERSHIP_STAG_V2_SCOPES : []),
              ],
              integrationProfile: AFFILIATIONS_ENROLLMENT_V2_PROFILE,
              status: 'ACTIVE',
              expiresAt,
            },
          });
          await tx.apiKeyCompany.create({ data: { apiKeyId: keyId, companyId } });
          if (association) {
            await tx.fiscalConsumerKeyBinding.create({
              data: { apiKeyId: keyId, tenantId, associationId: association.id },
            });
          }
          await tx.auditLog.create({
            data: {
              id: randomUUID(),
              tenantId,
              companyId,
              apiKeyId: keyId,
              actor: admin.id,
              action: rotate
                ? 'onboarding-v2.enrollment.grant.staged'
                : 'onboarding-v2.enrollment.grant.issued',
              eventClass: 'SECURITY',
              resource: `ApiKey:${keyId}`,
              metadata: {
                environment: 'SANDBOX',
                externalCompanyKey: `affiliations:${affiliationsCompanyId}`,
                associationId: association?.id ?? null,
                previousActiveKeyId: active[0]?.id ?? null,
              } as Prisma.JsonObject,
            },
          });
          return {
            keyId,
            expiresAt,
            associationId: association?.id ?? null,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      committed = true;
      process.stdout.write(
        JSON.stringify({ ...issued, companyId, environment: 'SANDBOX', outputFileCreated: true }) +
          '\n',
      );
    } finally {
      if (!committed) await fs.unlink(outputPath!).catch(() => undefined);
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : '';
  process.stderr.write(
    `${
      /^(?:SPEC09_|BILLING_ADMIN_|ENROLLMENT_)[A-Z0-9_]+$/.test(message) ||
      message.startsWith('Usage: spec09-issue-enrollment-key-lab ')
        ? message
        : 'ENROLLMENT_GRANT_FAILED'
    }\n`,
  );
  process.exitCode = 1;
});
