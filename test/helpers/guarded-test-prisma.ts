import { PrismaClient } from '@prisma/client';
import {
  assertDisposableDatabaseMarker,
  GuardedTestDatabase,
  installGuardedTestDatabaseEnvironment,
  TestEnvironment,
} from './test-database-safety';

export interface GuardedTestPrismaContext {
  readonly prisma: PrismaClient;
  readonly database: GuardedTestDatabase;
}

export async function createGuardedTestPrisma(
  env: TestEnvironment = process.env,
): Promise<GuardedTestPrismaContext> {
  const database = installGuardedTestDatabaseEnvironment(env);
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: database.databaseUrl,
      },
    },
  });

  try {
    await prisma.$connect();
    await assertDisposableDatabaseMarker(prisma, env);
    return { prisma, database };
  } catch (error) {
    await prisma.$disconnect();
    throw error;
  }
}
