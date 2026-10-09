const { spawnSync } = require('node:child_process');
const { resolve } = require('node:path');

module.exports = function validateDisposableDatabaseBeforeE2e() {
  const helperPath = resolve(__dirname, 'guarded-test-prisma.ts');
  const projectPath = resolve(__dirname, '../../tsconfig.json');
  const runner = [
    "const { createGuardedTestPrisma } = require(process.argv[1]);",
    '(async () => {',
    '  const { prisma } = await createGuardedTestPrisma();',
    '  await prisma.$disconnect();',
    '})().catch((error) => {',
    "  console.error(error instanceof Error ? error.message : 'Database safety setup failed.');",
    '  process.exit(1);',
    '});',
  ].join('\n');

  const result = spawnSync(
    process.execPath,
    ['-r', 'ts-node/register/transpile-only', '-e', runner, helperPath],
    {
      cwd: resolve(__dirname, '../..'),
      env: {
        ...process.env,
        TS_NODE_PROJECT: projectPath,
        TS_NODE_TRANSPILE_ONLY: 'true',
        TS_NODE_COMPILER_OPTIONS: JSON.stringify({
          module: 'CommonJS',
          moduleResolution: 'Node',
        }),
      },
      stdio: 'inherit',
      windowsHide: true,
    },
  );

  if (result.status !== 0) {
    throw new Error('Disposable database global safety validation failed.');
  }
};
