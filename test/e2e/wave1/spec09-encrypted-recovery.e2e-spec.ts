import { PrismaClient } from '@prisma/client';
import { spawnSync } from 'child_process';
import { createHash, randomBytes, randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  EncryptedFileSecretProvider,
  initializeEncryptedFileSecretStore,
} from '../../../src/infrastructure/secrets/adapters/encrypted-file-secret-provider.adapter';
import {
  backupEncryptedSecretStore,
  restoreEncryptedSecretStore,
} from '../../../src/infrastructure/secrets/local-secret-store-backup';
import { createGuardedTestPrisma } from '../../helpers/guarded-test-prisma';
import { createTestCompany, createTestTenant } from '../../helpers/test-factories';
import { installGuardedTestDatabaseEnvironment } from '../../helpers/test-database-safety';

function docker(args: string[], input?: Buffer, includeStderr = false): Buffer {
  const result = spawnSync('docker', args, {
    input,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`Disposable Docker operation failed: ${args[0]}`);
  return includeStderr ? Buffer.concat([result.stdout, result.stderr]) : result.stdout;
}

async function digestState(prisma: PrismaClient, companyId: string) {
  const [company, certificate, connection, profile, activities, points] = await Promise.all([
    prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { identificationNumber: true, legalName: true },
    }),
    prisma.fiscalSigningCertificate.findMany({
      where: { companyId },
      select: {
        status: true,
        fingerprintSha256: true,
        certificateSecretReference: true,
        passwordSecretReference: true,
      },
    }),
    prisma.haciendaConnection.findMany({
      where: { companyId },
      select: { environment: true, status: true, secretReference: true },
    }),
    prisma.companyFiscalProfile.findUniqueOrThrow({
      where: { companyId },
      select: {
        province: true,
        canton: true,
        district: true,
        otrasSenas: true,
        email: true,
        defaultEconomicActivityId: true,
      },
    }),
    prisma.companyEconomicActivity.findMany({
      where: { companyId },
      select: { id: true, code: true, billingEnabled: true, verificationSource: true },
    }),
    prisma.fiscalIssuancePoint.findMany({
      where: { companyId },
      select: { branchCode: true, terminalCode: true, environment: true, active: true },
    }),
  ]);
  return createHash('sha256')
    .update(JSON.stringify({ company, certificate, connection, profile, activities, points }))
    .digest('hex');
}

async function filesBelow(root: string): Promise<Buffer[]> {
  const result: Buffer[] = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...(await filesBelow(file)));
    else if (entry.isFile()) result.push(await fs.readFile(file));
  }
  return result;
}

describe('SPEC-09 paired synthetic PostgreSQL and encrypted-store recovery', () => {
  jest.setTimeout(180000);

  it('restores fiscal references with the separate key and rejects a wrong key without losing source state', async () => {
    installGuardedTestDatabaseEnvironment();
    const { prisma } = await createGuardedTestPrisma();
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'billing-spec09-recovery-'));
    const resolvedTemp = path.resolve(os.tmpdir());
    const resolvedParent = path.resolve(parent);
    if (!resolvedParent.startsWith(resolvedTemp + path.sep))
      throw new Error('Unsafe temporary root');
    const sourceStore = path.join(parent, 'source-store');
    const backupStore = path.join(parent, 'backup-store');
    const restoredStore = path.join(parent, 'restored-store');
    const keyPath = path.join(parent, 'master.key');
    const recoveredKeyPath = path.join(parent, 'recovered-master.key');
    const dpapiBackupPath = path.join(parent, 'dpapi-master-backup');
    const wrongKeyPath = path.join(parent, 'wrong.key');
    const restoredContainer = `billing-spec09-restore-${randomBytes(5).toString('hex')}`;
    const keyContainer = `billing-spec09-key-restore-${randomBytes(5).toString('hex')}`;
    let containerCreated = false;
    let keyContainerCreated = false;
    try {
      await initializeEncryptedFileSecretStore({ rootPath: sourceStore, masterKeyPath: keyPath });
      const provider = new EncryptedFileSecretProvider({
        rootPath: sourceStore,
        masterKeyPath: keyPath,
      });
      const tenant = await createTestTenant(prisma);
      const company = await createTestCompany(prisma, tenant.id);
      const certRef = `synthetic/${randomUUID()}/certificate`;
      const pinRef = `synthetic/${randomUUID()}/pin`;
      const credentialRef = `synthetic/${randomUUID()}/credentials`;
      const values = [
        `synthetic-certificate-${randomUUID()}`,
        `synthetic-pin-${randomUUID()}`,
        `synthetic-credential-${randomUUID()}`,
      ];
      await provider.storeSecret(certRef, values[0]);
      await provider.storeSecret(pinRef, values[1]);
      await provider.storeSecret(credentialRef, values[2]);
      const activityId = randomUUID();
      await prisma.companyEconomicActivity.create({
        data: {
          id: activityId,
          tenantId: tenant.id,
          companyId: company.id,
          code: '9609.0',
          description: 'Synthetic verified activity',
          haciendaStatus: 'A',
          billingEnabled: true,
          verifiedAt: new Date(),
          lastSeenAt: new Date(),
          verificationSource: 'HACIENDA_FE_AE',
        },
      });
      await prisma.companyFiscalProfile.create({
        data: {
          id: randomUUID(),
          tenantId: tenant.id,
          companyId: company.id,
          province: '1',
          canton: '01',
          district: '01',
          otrasSenas: 'Synthetic address',
          email: 'synthetic@example.invalid',
          economicActivityCode: '9609.0',
          defaultEconomicActivityId: activityId,
        },
      });
      await prisma.fiscalSigningCertificate.create({
        data: {
          id: randomUUID(),
          tenantId: tenant.id,
          companyId: company.id,
          environment: 'SANDBOX',
          status: 'ACTIVE',
          certificateType: 'HACIENDA_CRYPTOGRAPHIC_KEY',
          certificateSecretReference: certRef,
          passwordSecretReference: pinRef,
          fingerprintSha256: createHash('sha256').update(values[0]).digest('hex'),
        },
      });
      await prisma.haciendaConnection.create({
        data: {
          id: randomUUID(),
          tenantId: tenant.id,
          companyId: company.id,
          environment: 'SANDBOX',
          status: 'PENDING_VALIDATION',
          secretReference: credentialRef,
        },
      });
      await prisma.fiscalIssuancePoint.create({
        data: {
          id: randomUUID(),
          tenantId: tenant.id,
          companyId: company.id,
          environment: 'SANDBOX',
          branchCode: '001',
          terminalCode: '00001',
          name: 'Synthetic point',
          active: true,
          isDefault: true,
        },
      });
      const originalDigest = await digestState(prisma, company.id);
      const sourceUrl = new URL(process.env.BILLING_TEST_DATABASE_URL!);
      const sourceContainer = `billing-p0-${process.env.BILLING_TEST_RUN_ID}`;
      const databaseDump = docker([
        'exec',
        '-e',
        `PGPASSWORD=${decodeURIComponent(sourceUrl.password)}`,
        sourceContainer,
        'pg_dump',
        '-U',
        decodeURIComponent(sourceUrl.username),
        '-Fc',
        '-d',
        sourceUrl.pathname.slice(1),
      ]);
      const dumpSha256 = createHash('sha256').update(databaseDump).digest('hex');
      const secretBackup = await backupEncryptedSecretStore({
        sourcePath: sourceStore,
        destinationPath: backupStore,
      });
      expect(secretBackup.files).toBeGreaterThan(3);

      if (process.platform === 'win32') {
        const dpapiScript = path.join(process.cwd(), 'scripts', 'spec09-backup-master-dpapi.ps1');
        const backupResult = spawnSync(
          'pwsh',
          [
            '-NoProfile',
            '-File',
            dpapiScript,
            '-Mode',
            'Backup',
            '-Directory',
            dpapiBackupPath,
            '-Source',
            'Synthetic',
            '-SyntheticKeyFile',
            keyPath,
          ],
          { windowsHide: true, encoding: 'utf8' },
        );
        expect(backupResult.status).toBe(0);
        expect(backupResult.stdout.trim()).toBe('SPEC09_MASTER_DPAPI_BACKUP_CREATED');
        const encryptedKeyBytes = await fs.readFile(path.join(dpapiBackupPath, 'master-key.dpapi'));
        expect(encryptedKeyBytes.includes(await fs.readFile(keyPath))).toBe(false);
        for (const value of values) {
          expect(encryptedKeyBytes.includes(Buffer.from(value))).toBe(false);
          expect(backupResult.stdout.includes(value)).toBe(false);
          expect(backupResult.stderr.includes(value)).toBe(false);
        }
        docker([
          'run',
          '--detach',
          '--name',
          keyContainer,
          '--label',
          'spec09-disposable-recovery=true',
          '--network',
          'none',
          '--tmpfs',
          '/run/spec09-key:rw,noexec,nosuid,size=1m',
          'alpine:3.20',
          'sleep',
          '300',
        ]);
        keyContainerCreated = true;
        const restoreKey = () =>
          spawnSync(
            'pwsh',
            [
              '-NoProfile',
              '-File',
              dpapiScript,
              '-Mode',
              'RestoreToDisposable',
              '-Directory',
              dpapiBackupPath,
              '-DisposableContainer',
              keyContainer,
            ],
            { windowsHide: true, encoding: 'utf8' },
          );
        expect(restoreKey().status).toBe(0);
        docker(['restart', keyContainer]);
        expect(
          docker(['exec', keyContainer, 'sh', '-c', 'test ! -e /run/spec09-key/master.key']).length,
        ).toBe(0);
        expect(restoreKey().status).toBe(0);
        await fs.writeFile(
          recoveredKeyPath,
          docker(['exec', keyContainer, 'cat', '/run/spec09-key/master.key']),
          { mode: 0o600 },
        );
        expect(
          createHash('sha256')
            .update(await fs.readFile(recoveredKeyPath))
            .digest('hex'),
        ).toBe(
          createHash('sha256')
            .update(await fs.readFile(keyPath))
            .digest('hex'),
        );
      }

      docker([
        'run',
        '--detach',
        '--name',
        restoredContainer,
        '--label',
        'com.billing.test-safety=true',
        '--network',
        'none',
        '--tmpfs',
        '/var/lib/postgresql/data:rw,noexec,nosuid,size=512m',
        '-e',
        'POSTGRES_HOST_AUTH_METHOD=trust',
        'postgres:15-alpine',
      ]);
      containerCreated = true;
      let ready = false;
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const probe = spawnSync(
          'docker',
          ['exec', restoredContainer, 'pg_isready', '-U', 'postgres', '-d', 'postgres'],
          { windowsHide: true },
        );
        if (probe.status === 0) {
          ready = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      expect(ready).toBe(true);
      docker(
        [
          'exec',
          '-i',
          restoredContainer,
          'pg_restore',
          '--exit-on-error',
          '--no-owner',
          '--no-acl',
          '-U',
          'postgres',
          '-d',
          'postgres',
        ],
        databaseDump,
      );
      const restoredDigest = docker([
        'exec',
        restoredContainer,
        'psql',
        '-X',
        '-A',
        '-t',
        '-U',
        'postgres',
        '-d',
        'postgres',
        '-c',
        `SELECT md5(identification_number || ':' || legal_name) FROM companies WHERE id = '${company.id}'`,
      ])
        .toString()
        .trim();
      expect(restoredDigest).toBe(
        createHash('md5')
          .update(`${company.identificationNumber}:${company.legalName}`)
          .digest('hex'),
      );
      const restoredRefs = docker([
        'exec',
        restoredContainer,
        'psql',
        '-X',
        '-A',
        '-t',
        '-U',
        'postgres',
        '-d',
        'postgres',
        '-c',
        `SELECT certificate_secret_reference || '|' || password_secret_reference FROM fiscal_signing_certificates WHERE company_id = '${company.id}'`,
      ])
        .toString()
        .trim();
      expect(restoredRefs).toBe(`${certRef}|${pinRef}`);
      const restoredCredentialRef = docker([
        'exec',
        restoredContainer,
        'psql',
        '-X',
        '-A',
        '-t',
        '-U',
        'postgres',
        '-d',
        'postgres',
        '-c',
        `SELECT secret_reference FROM hacienda_connections WHERE company_id = '${company.id}'`,
      ])
        .toString()
        .trim();
      expect(restoredCredentialRef).toBe(credentialRef);
      const restoredActivity = docker([
        'exec',
        restoredContainer,
        'psql',
        '-X',
        '-A',
        '-t',
        '-U',
        'postgres',
        '-d',
        'postgres',
        '-c',
        `SELECT default_economic_activity_id FROM company_fiscal_profiles WHERE company_id = '${company.id}'`,
      ])
        .toString()
        .trim();
      expect(restoredActivity).toBe(activityId);
      const restoredPoint = docker([
        'exec',
        restoredContainer,
        'psql',
        '-X',
        '-A',
        '-t',
        '-U',
        'postgres',
        '-d',
        'postgres',
        '-c',
        `SELECT branch_code || '/' || terminal_code FROM fiscal_issuance_points WHERE company_id = '${company.id}'`,
      ])
        .toString()
        .trim();
      expect(restoredPoint).toBe('001/00001');
      expect(await digestState(prisma, company.id)).toBe(originalDigest);
      expect(createHash('sha256').update(databaseDump).digest('hex')).toBe(dumpSha256);
      const restoration = await restoreEncryptedSecretStore({
        backupPath: backupStore,
        destinationPath: restoredStore,
        masterKeyPath: process.platform === 'win32' ? recoveredKeyPath : keyPath,
      });
      expect(restoration.activeSecrets).toBe(3);
      const restoredProvider = new EncryptedFileSecretProvider({
        rootPath: restoredStore,
        masterKeyPath: process.platform === 'win32' ? recoveredKeyPath : keyPath,
      });
      for (const [index, reference] of [certRef, pinRef, credentialRef].entries())
        expect(await restoredProvider.getSecret(reference)).toBe(values[index]);
      const backupBytes = Buffer.concat(await filesBelow(backupStore));
      for (const value of values) expect(backupBytes.includes(Buffer.from(value))).toBe(false);
      await fs.writeFile(wrongKeyPath, randomBytes(32), { mode: 0o600 });
      await expect(
        restoreEncryptedSecretStore({
          backupPath: backupStore,
          destinationPath: path.join(parent, 'wrong-key-restore'),
          masterKeyPath: wrongKeyPath,
        }),
      ).rejects.toMatchObject({ code: 'SECRET_MASTER_KEY_MISMATCH' });
      for (const [index, reference] of [certRef, pinRef, credentialRef].entries())
        expect(await provider.getSecret(reference)).toBe(values[index]);
      expect(await digestState(prisma, company.id)).toBe(originalDigest);
      const temporaryBytes = Buffer.concat(await filesBelow(parent));
      for (const value of values) expect(temporaryBytes.includes(Buffer.from(value))).toBe(false);
      const restoreLogs = docker(['logs', restoredContainer], undefined, true);
      for (const value of values) expect(restoreLogs.includes(Buffer.from(value))).toBe(false);
    } finally {
      await prisma.$disconnect();
      if (keyContainerCreated) {
        const label = docker([
          'inspect',
          '--format',
          '{{ index .Config.Labels "spec09-disposable-recovery" }}',
          keyContainer,
        ])
          .toString()
          .trim();
        if (label !== 'true') throw new Error('Refusing to remove unlabelled key container');
        docker(['rm', '--force', keyContainer]);
      }
      if (containerCreated) {
        const label = docker([
          'inspect',
          '--format',
          '{{ index .Config.Labels "com.billing.test-safety" }}',
          restoredContainer,
        ])
          .toString()
          .trim();
        if (label !== 'true') throw new Error('Refusing to remove unlabelled restore container');
        docker(['rm', '--force', restoredContainer]);
      }
      await fs.rm(resolvedParent, { recursive: true, force: true });
    }
  });
});
