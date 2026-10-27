#!/usr/bin/env node

// Code checkout update only. It never builds, migrates a database or deploys.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const shaArg = args.find((arg) => arg.startsWith('--expected-sha='));
const expectedSha = shaArg?.slice('--expected-sha='.length);

function git(...gitArgs) {
  const result = spawnSync('git', ['-C', root, ...gitArgs], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${gitArgs[0]} failed: ${(result.stderr || '').trim()}`);
  }
  return result.stdout.trim();
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 2;
}

if (args.includes('--help')) {
  process.stdout.write(
    'Usage: node scripts/update-billing-from-main.mjs [--apply --expected-sha=<40-hex>]\n' +
      'Default is a read-only local preflight. --apply fetches origin/main and fast-forwards a clean main checkout only. No build, migration or deployment.\n',
  );
} else if (args.some((arg) => arg !== '--apply' && !arg.startsWith('--expected-sha='))) {
  fail('Unknown option. Use --help.');
} else if (apply && !/^[a-f0-9]{40}$/i.test(expectedSha ?? '')) {
  fail('--apply requires the exact reviewed --expected-sha=<40-hex>.');
} else {
  try {
    const branch = git('symbolic-ref', '--quiet', '--short', 'HEAD');
    const worktreeStatus = git('status', '--porcelain', '--untracked-files=normal');
    const currentSha = git('rev-parse', 'HEAD');
    if (branch !== 'main') {
      fail(`Refusing update: checkout is on ${branch}; main is required.`);
    } else if (worktreeStatus) {
      fail('Refusing update: checkout has uncommitted or untracked files.');
    } else {
      if (apply) git('fetch', '--no-tags', 'origin', 'main');
      const targetSha = git('rev-parse', '--verify', 'refs/remotes/origin/main');
      if (apply && targetSha.toLowerCase() !== expectedSha.toLowerCase()) {
        fail(`Refusing update: origin/main is ${targetSha}, not the reviewed SHA.`);
      } else {
        const ancestor = spawnSync(
          'git',
          ['-C', root, 'merge-base', '--is-ancestor', currentSha, targetSha],
          { encoding: 'utf8' },
        );
        if (ancestor.status !== 0) {
          fail('Refusing update: main cannot fast-forward to origin/main.');
        } else if (apply) {
          git('merge', '--ff-only', targetSha);
          process.stdout.write(`Billing code updated from ${currentSha} to ${targetSha}.\n`);
          process.stdout.write('No database migration, build or deployment was run.\n');
        } else {
          process.stdout.write(`Read-only preflight: main ${currentSha} -> origin/main ${targetSha}.\n`);
          process.stdout.write(
            `After approval: node scripts/update-billing-from-main.mjs --apply --expected-sha=${targetSha}\n`,
          );
        }
      }
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}
