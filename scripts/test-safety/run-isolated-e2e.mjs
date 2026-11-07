import { spawnSync } from 'node:child_process';
import { relative, resolve, sep } from 'node:path';

const root = process.cwd();
const listed = spawnSync(
  process.execPath,
  ['node_modules/jest/bin/jest.js', '--config', './test/jest-e2e.json', '--runInBand', '--listTests'],
  { cwd: root, encoding: 'utf8', windowsHide: true },
);
if (listed.status !== 0) {
  process.stderr.write(listed.stderr || 'Could not enumerate E2E suites.\n');
  process.exit(1);
}

const suites = listed.stdout
  .split(/\r?\n/)
  .filter((line) => line.endsWith('.e2e-spec.ts'))
  .map((file) => relative(root, resolve(file)).split(sep).join('/'))
  .sort();
if (suites.length === 0 || suites.some((file) => file.startsWith('../') || file.startsWith('/'))) {
  throw new Error('E2E suite inventory is empty or outside the repository.');
}

let passed = 0;
let passedTests = 0;
let totalTests = 0;
for (const suite of suites) {
  process.stdout.write(`E2E_ISOLATED_SUITE ${passed + 1}/${suites.length} ${suite}\n`);
  // A new guarded PostgreSQL and storage root per suite prevents one suite's
  // background jobs, data and recovery dump from affecting another suite.
  const result = spawnSync(
    process.execPath,
    [
      'scripts/test-safety/disposable-postgres.mjs',
      'run',
      '--',
      process.execPath,
      'scripts/test-safety/run-disposable-validation.mjs',
      'e2e',
      suite,
    ],
    { cwd: root, env: process.env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true },
  );
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  if (result.status !== 0) {
    process.stderr.write(`E2E_ISOLATED_FAILED ${suite}\n`);
    const failureKind = /Docker command failed:/i.test(output)
      ? 'DOCKER_PROVISION_OR_CLEANUP'
      : /Disposable PostgreSQL did not become stably ready/i.test(output)
        ? 'POSTGRES_STARTUP'
        : /Error: P\d{4}|Migration failed|prisma migrate/i.test(output) &&
            !/All migrations have been successfully applied/i.test(output)
          ? 'MIGRATION'
          : /^FAIL /m.test(output)
            ? 'JEST_ASSERTION'
            : /^PASS /m.test(output)
              ? 'POST_JEST_CLEANUP'
              : 'PROCESS_OR_ENVIRONMENT';
    process.stderr.write(
      `E2E_ISOLATED_FAILURE_KIND ${failureKind} exit=${result.status ?? 'null'} signal=${result.signal ?? 'none'}\n`,
    );
    for (const line of output.split(/\r?\n/)) {
      if (
        /^FAIL |^  ●|^Test Suites:|^Tests:|^E2E_ISOLATED_|^\s*(?:Expected:|Received:|W3_EXPECTED_201_GOT_|at Object\.<anonymous>)/.test(
          line,
        )
      )
        process.stderr.write(`${line}\n`);
    }
    if (result.error) process.stderr.write(`E2E_ISOLATED_PROCESS_ERROR ${result.error.name}\n`);
    process.exit(result.status ?? 1);
  }
  const summary = [...output.matchAll(/^Tests:\s*(?:\d+ skipped,\s*)?(\d+) passed,\s*(\d+) total$/gm)].at(-1);
  if (!summary || !/^Test Suites:\s*1 passed, 1 total$/m.test(output)) {
    throw new Error(`E2E suite completed without a verifiable Jest summary: ${suite}`);
  }
  passedTests += Number(summary[1]);
  totalTests += Number(summary[2]);
  passed += 1;
  process.stdout.write(`E2E_ISOLATED_RESULT ${suite} ${summary[1]}/${summary[2]}\n`);
}
process.stdout.write(`E2E_ISOLATED_PASS ${passed}/${suites.length} ${passedTests}/${totalTests}\n`);
