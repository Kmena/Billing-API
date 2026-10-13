import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { createGuardedTestPrisma } from '../helpers/guarded-test-prisma';
import { assertDisposableDatabaseMarker } from '../helpers/test-database-safety';

const ROLLBACK = new Error('ROLLBACK_MARKER_TEST');

async function withRolledBackMarkerMutation(
  prisma: PrismaClient,
  mutate: (transaction: Prisma.TransactionClient) => Promise<void>,
  assertion: (transaction: Prisma.TransactionClient) => Promise<void>,
): Promise<void> {
  try {
    await prisma.$transaction(async (transaction) => {
      await mutate(transaction);
      await assertion(transaction);
      throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }
}

describe('disposable PostgreSQL marker contract', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    ({ prisma } = await createGuardedTestPrisma());
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('accepts the valid marker bound to the current database, role, run and token', async () => {
    await expect(assertDisposableDatabaseMarker(prisma)).resolves.toMatchObject({
      runId: process.env.BILLING_TEST_RUN_ID,
      roleName: process.env.BILLING_TEST_DATABASE_ROLE,
    });
  });

  it('rejects a disposable-looking database when its marker is absent', async () => {
    let rejected = false;
    await withRolledBackMarkerMutation(
      prisma,
      async (transaction) => {
        await transaction.$executeRaw(
          Prisma.raw('DELETE FROM billing_test_safety.marker WHERE marker_id = 1'),
        );
      },
      async (transaction) => {
        try {
          await assertDisposableDatabaseMarker(transaction as unknown as PrismaClient);
        } catch (error) {
          rejected = error instanceof Error && error.message.includes('exactly one active marker');
        }
      },
    );
    expect(rejected).toBe(true);
  });

  it('rejects a marker bound to another run', async () => {
    let rejected = false;
    await withRolledBackMarkerMutation(
      prisma,
      async (transaction) => {
        await transaction.$executeRaw(
          Prisma.raw(
            'UPDATE billing_test_safety.marker SET run_id = ' +
              "'foreign_run_1234' WHERE marker_id = 1",
          ),
        );
      },
      async (transaction) => {
        try {
          await assertDisposableDatabaseMarker(transaction as unknown as PrismaClient);
        } catch (error) {
          rejected = error instanceof Error && error.message.includes('does not match');
        }
      },
    );
    expect(rejected).toBe(true);
  });

  it('rejects the correct marker when the supplied temporary token is wrong', async () => {
    await expect(
      assertDisposableDatabaseMarker(prisma, {
        ...process.env,
        BILLING_TEST_RUN_TOKEN: 'wrong_temporary_token_0123456789abcdef',
      }),
    ).rejects.toThrow('does not match');
  });
});
