#!/usr/bin/env node
// Operator-installed entry point. No target commands or credentials live in this repo.
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_CONFIG = '/etc/billing/billing-update.json';
const SHA = /^[a-f0-9]{40}$/i;
const PHASES = [
  'migrationPreflight',
  'backup',
  'restoreVerification',
  'updateApi',
  'updateWorkers',
  'healthCheck',
];

export function validateConfig(config) {
  if (
    !config ||
    config.version !== 1 ||
    !path.isAbsolute(config.checkout) ||
    !SHA.test(config.approvedSha || '')
  )
    throw new Error('BILLING_UPDATE_CONFIG_INVALID');
  for (const phase of PHASES) {
    const command = config[phase];
    if (
      !command ||
      !path.isAbsolute(command.file) ||
      !Array.isArray(command.args) ||
      command.args.some((arg) => typeof arg !== 'string')
    ) {
      throw new Error(`BILLING_UPDATE_${phase.toUpperCase()}_MISSING`);
    }
  }
  return config;
}

function execute(file, args, options = {}) {
  const result = spawnSync(file, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    timeout: 30 * 60 * 1000,
    shell: false,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${options.label || path.basename(file)} failed: ${
        result.error?.message ||
        (result.stderr || '').trim().slice(0, 500) ||
        `exit ${result.status}`
      }`,
    );
  }
  return (result.stdout || '').trim();
}

/** Injectable runner makes the complete failure order testable without a server. */
export function runUpdate(rawConfig, run = execute, apply = false) {
  const config = validateConfig(rawConfig);
  const git = (...args) =>
    run('git', ['-C', config.checkout, ...args], { label: `git ${args[0]}` });
  const branch = git('symbolic-ref', '--quiet', '--short', 'HEAD');
  if (branch !== 'main') throw new Error('BILLING_UPDATE_MAIN_REQUIRED');
  if (git('status', '--porcelain', '--untracked-files=normal'))
    throw new Error('BILLING_UPDATE_CHECKOUT_NOT_CLEAN');
  const previousSha = git('rev-parse', 'HEAD');
  if (apply) git('fetch', '--no-tags', 'origin', 'main');
  const targetSha = git('rev-parse', '--verify', 'refs/remotes/origin/main');
  if (targetSha.toLowerCase() !== config.approvedSha.toLowerCase())
    throw new Error('BILLING_UPDATE_MAIN_NOT_APPROVED');
  git('merge-base', '--is-ancestor', previousSha, targetSha);
  if (!apply) return { previousSha, targetSha, mode: 'CHECK_ONLY' };

  const phase = (name, extraArgs = []) => {
    const command = config[name];
    return run(command.file, [...command.args, ...extraArgs], {
      label: name,
      cwd: config.checkout,
    });
  };
  // Backups and a scratch restore check must pass before the checkout changes.
  phase('migrationPreflight');
  const backupManifest = phase('backup');
  if (!path.isAbsolute(backupManifest || '') || /[\r\n\0]/.test(backupManifest))
    throw new Error('BILLING_UPDATE_BACKUP_MANIFEST_MISSING');
  phase('restoreVerification', [backupManifest]);
  git('merge', '--ff-only', targetSha);
  phase('updateApi');
  phase('updateWorkers');
  phase('healthCheck');
  return { previousSha, targetSha, mode: 'UPDATED' };
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    const args = process.argv.slice(2);
    if (args.includes('--help')) {
      process.stdout.write(
        'Usage: sudo billing-update [--check]\n' +
          'Apply requires root-owned /etc/billing/billing-update.json and an approved main SHA.\n',
      );
    } else if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) {
      throw new Error('BILLING_UPDATE_UNKNOWN_OPTION');
    } else {
      const apply = !args.includes('--check');
      if (apply && process.getuid?.() !== 0) throw new Error('BILLING_UPDATE_ROOT_REQUIRED');
      const metadata = statSync(DEFAULT_CONFIG);
      if (apply && (metadata.uid !== 0 || (metadata.mode & 0o022) !== 0))
        throw new Error('BILLING_UPDATE_CONFIG_MUST_BE_ROOT_OWNED');
      const config = JSON.parse(readFileSync(DEFAULT_CONFIG, 'utf8'));
      const result = runUpdate(config, execute, apply);
      process.stdout.write(JSON.stringify(result) + '\n');
    }
  } catch (error) {
    process.stderr.write(`Billing update stopped: ${error.message}\n`);
    process.exitCode = 2;
  }
}
