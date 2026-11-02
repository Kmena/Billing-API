import * as argon2 from 'argon2';
import { randomUUID } from 'crypto';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { ConsumerV2LabService } from '../src/modules/fiscal-consumers/application/consumer-v2-lab.service';
import { PrismaConsumerV2Repository } from '../src/modules/fiscal-consumers/infrastructure/persistence/prisma-consumer-v2.repository';
import {
  assertDisposableDatabaseMarker,
  installGuardedTestDatabaseEnvironment,
} from '../test/helpers/test-database-safety';

/** Local SANDBOX bootstrap. The disposable DB guard forbids real Billing databases. */
async function main() {
  const [tenantId, companyId, adminEmail, externalConsumerKey, externalCompanyKey] =
    process.argv.slice(2);
  if (!tenantId || !companyId || !adminEmail || !externalConsumerKey || !externalCompanyKey) {
    throw new Error(
      'Usage: spec09-bind-affiliations-lab <tenantId> <companyId> <adminEmail> <externalConsumerKey> <externalCompanyKey> (admin password on stdin)',
    );
  }
  if (process.stdin.isTTY)
    throw new Error(
      'Pipe the administrator password on stdin; it must not appear in command arguments or shell history.',
    );
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
    if (!admin || !(await argon2.verify(admin.passwordHash, password))) {
      throw new Error('BILLING_ADMIN_AUTHENTICATION_FAILED');
    }
    const lab = new ConsumerV2LabService(new PrismaConsumerV2Repository(prisma));
    const result = await lab.registerAssociation({
      tenantId,
      companyId,
      provider: 'AFFILIATIONS',
      externalConsumerKey,
      externalCompanyKey,
      environment: 'SANDBOX',
      actorId: admin.id,
      correlationId: randomUUID(),
    });
    process.stdout.write(
      `${JSON.stringify({
        associationId: result.associationId,
        consumerId: result.consumerId,
        companyId: result.companyId,
        environment: result.environment,
        created: result.created,
      })}\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'BINDING_FAILED'}\n`);
  process.exitCode = 1;
});
