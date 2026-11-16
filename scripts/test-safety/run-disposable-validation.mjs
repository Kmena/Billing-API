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
  if (process.argv[4]) e2eArgs.push('--testNamePattern', process.argv[4]);
  if (process.argv[3]) {
    run(e2eArgs);
  } else {
    // A Jest environment can leave async PDF and queue callbacks alive after a
    // suite ends. Give every suite its own process while retaining the same
    // labeled disposable database and migration state.
    const listing = spawnSync(
      process.execPath,
      ['node_modules/jest/bin/jest.js', '--config', './test/jest-e2e.json', '--listTests', '--json'],
      { cwd: process.cwd(), env: process.env, encoding: 'utf8', windowsHide: true },
    );
    if (listing.status !== 0) throw new Error(listing.stderr || 'Could not list E2E suites');
    const paths = JSON.parse(listing.stdout);
    if (!Array.isArray(paths) || paths.length === 0) throw new Error('No E2E suites found');
    for (const [index, path] of paths.entries()) {
      process.stdout.write(`E2E_SUITE ${index + 1}/${paths.length} ${path}\n`);
      run([...e2eArgs, '--runTestsByPath', path]);
    }
  }
} else {
  run([
    'node_modules/jest/bin/jest.js',
    '--runInBand',
    '--testPathPattern',
    'f3-postgres-concurrency.spec.ts|f4-postgres-concurrency.spec.ts',
  ]);
}
