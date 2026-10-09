import { installGuardedTestDatabaseEnvironment } from './test-database-safety';

// Jest loads this before any E2E module can construct PrismaClient.
installGuardedTestDatabaseEnvironment();
