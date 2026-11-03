import * as argon2 from 'argon2';
import { randomBytes, randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import {
  AFFILIATIONS_ENROLLMENT_V2_PROFILE,
  AFFILIATIONS_ENROLLMENT_V2_SCOPES,
  AFFILIATIONS_FISCAL_DETAILS_V2_SCOPES,
} from '../src/modules/fiscal-consumers/domain/consumer-v2.policy';
import {
  assertDisposableDatabaseMarker,
  installGuardedTestDatabaseEnvironment,
} from '../test/helpers/test-database-safety';

/**
 * Billing administrator issues one company/SANDBOX grant once. Thereafter
 * Afiliaciones initiates onboarding by API without another Billing action.
 */
async function main() {
  const [tenantId, companyId, affiliationsCompanyId, adminEmail, action] = process.argv.slice(2);
  const uuid = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;
  if (
    ![tenantId, companyId, affiliationsCompanyId].every((value) => uuid.test(value ?? '')) ||
    !adminEmail ||
    (action && action !== '--rotate')
  )
    throw new Error(
      'Usage: spec09-issue-enrollment-key-lab <tenantId> <billingCompanyId> <affiliationsCompanyId> <billingAdminEmail> (password on stdin)',
    );
  if (process.stdin.isTTY)
    throw new Error('Administrator password must be piped on stdin, never in arguments.');
  const guarded = installGuardedTestDatabaseEnvironment();
  const prisma = new PrismaService({ datasources: { db: { url: guarded.databaseUrl } } });
  try {
    await prisma.$connect();
    await assertDisposableDatabaseMarker(prisma);
    const password = await new Promise<string>((resolve, reject) => {
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
    const prefix = randomBytes(4).toString('hex');
    const raw = `bk_test_${prefix}_${randomBytes(16).toString('hex')}`;
    const hash = await argon2.hash(raw);
    const issued = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${name}, 0))`;
        const company = await tx.company.findFirst({
          where: { id: companyId, tenantId, status: 'ACTIVE' },
          select: { id: true },
        });
        if (!company) throw new Error('ENROLLMENT_COMPANY_NOT_FOUND');
        const duplicate = await tx.apiKey.findFirst({
          where: {
            tenantId,
            name,
            integrationProfile: AFFILIATIONS_ENROLLMENT_V2_PROFILE,
            status: 'ACTIVE',
            expiresAt: { gt: new Date() },
          },
        });
        if (duplicate && action !== '--rotate') throw new Error('ENROLLMENT_GRANT_ALREADY_EXISTS');
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
        const previousBindings = association
          ? await tx.fiscalConsumerKeyBinding.findMany({
              where: { associationId: association.id },
              include: { apiKey: true },
            })
          : [];
        const keyId = randomUUID();
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
            ],
            integrationProfile: AFFILIATIONS_ENROLLMENT_V2_PROFILE,
            status: 'ACTIVE',
            expiresAt: new Date(Date.now() + 7 * 86_400_000),
          },
        });
        await tx.apiKeyCompany.create({ data: { apiKeyId: keyId, companyId } });
        if (association) {
          await tx.fiscalConsumerKeyBinding.create({
            data: { apiKeyId: keyId, tenantId, associationId: association.id },
          });
        }
        const oldIds = [
          ...(duplicate ? [duplicate.id] : []),
          ...previousBindings
            .filter(
              (binding) => binding.apiKey.integrationProfile === AFFILIATIONS_ENROLLMENT_V2_PROFILE,
            )
            .map((binding) => binding.apiKeyId),
        ];
        const revoked = oldIds.length
          ? await tx.apiKey.updateMany({
              where: { id: { in: [...new Set(oldIds)] }, tenantId, status: 'ACTIVE' },
              data: { status: 'REVOKED', revokedAt: new Date(), revokedBy: admin.id },
            })
          : { count: 0 };
        await tx.auditLog.create({
          data: {
            id: randomUUID(),
            tenantId,
            companyId,
            apiKeyId: keyId,
            actor: admin.id,
            action: oldIds.length
              ? 'onboarding-v2.enrollment.grant.rotated'
              : 'onboarding-v2.enrollment.grant.issued',
            eventClass: 'SECURITY',
            resource: `ApiKey:${keyId}`,
            metadata: {
              environment: 'SANDBOX',
              externalCompanyKey: `affiliations:${affiliationsCompanyId}`,
              associationId: association?.id ?? null,
              revokedKeyCount: revoked.count,
            } as Prisma.JsonObject,
          },
        });
        return {
          keyId,
          expiresAt: new Date(Date.now() + 7 * 86_400_000),
          associationId: association?.id ?? null,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    // Only emitted to the local operator's secure terminal; never returned by HTTP.
    process.stdout.write(
      JSON.stringify({ ...issued, companyId, environment: 'SANDBOX', key: raw }) + '\n',
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'ENROLLMENT_GRANT_FAILED'}\n`);
  process.exitCode = 1;
});
