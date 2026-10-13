import { spawnSync } from 'node:child_process';

function run(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const suite = process.argv[2];
if (!['safety-db', 'e2e', 'db-regression'].includes(suite)) {
  throw new Error('Usage: run-disposable-validation.mjs <safety-db|e2e|db-regression>');
}

run(['node_modules/prisma/build/index.js', 'migrate', 'deploy']);

if (suite === 'safety-db') {
  run([
    'node_modules/jest/bin/jest.js',
    '--config',
    './test/jest-safety-db.json',
    '--runInBand',
    '--silent',
  ]);
} else if (suite === 'e2e') {
  const e2eArgs = [
    'node_modules/jest/bin/jest.js',
    '--config',
    './test/jest-e2e.json',
    '--runInBand',
  ];
  if (process.argv[3]) e2eArgs.push('--testPathPattern', process.argv[3]);
  run(e2eArgs);
} else {
  run([
    'node_modules/jest/bin/jest.js',
    '--runInBand',
    '--testPathPattern',
    'f3-postgres-concurrency.spec.ts|f4-postgres-concurrency.spec.ts',
  ]);
}
