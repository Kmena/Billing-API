#!/usr/bin/env node
// Operator-installed entry point. No target commands or credentials live in this repo.
import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  closeSync,
  constants,
  lstatSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_CONFIG = '/etc/billing/billing-update.json';
const SHA = /^[a-f0-9]{40}$/i;
const PHASES = [
  'configurationCheck',
  'migrationPreflight',
  'backup',
  'restoreVerification',
  'updateApi',
  'updateWorkers',
  'healthCheck',
];

export function validateConfig(config) {
  const resultRelative =
    typeof config?.checkout === 'string' && typeof config?.resultLog === 'string'
      ? path.relative(config.checkout, config.resultLog)
      : '';
  const resultOutsideCheckout =
    resultRelative === '..' ||
    resultRelative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(resultRelative);
  if (
    !config ||
    config.version !== 1 ||
    typeof config.checkout !== 'string' ||
    !path.isAbsolute(config.checkout) ||
    typeof config.resultLog !== 'string' ||
    !path.isAbsolute(config.resultLog) ||
    !resultOutsideCheckout ||
    config.environment !== 'staging' ||
    !SHA.test(config.approvedSha || '')
  )
    throw new Error('BILLING_UPDATE_CONFIG_INVALID');
  for (const phase of PHASES) {
    const command = config[phase];
    if (
      !command ||
      typeof command.file !== 'string' ||
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
    // Child output can contain connection strings or credentials. Keep it out of logs.
    throw new Error(`BILLING_UPDATE_COMMAND_FAILED_${options.label || 'unknown'}`);
  }
  return (result.stdout || '').trim();
}

function writeResult(config, event) {
  appendFileSync(
    config.resultLog,
    `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`,
    {
      encoding: 'utf8',
      flag:
        constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | (constants.O_NOFOLLOW || 0),
      mode: 0o600,
    },
  );
}

function verifyBackupManifest(manifestPath) {
  try {
    const info = lstatSync(manifestPath);
    if (!info.isFile() || info.size === 0) throw new Error();
  } catch {
    throw new Error('BILLING_UPDATE_BACKUP_MANIFEST_UNAVAILABLE');
  }
}

/** Injectable runner and recorder make the failure order testable without a server. */
export function runUpdate(
  rawConfig,
  run = execute,
  apply = false,
  record = writeResult,
  verifyManifest = verifyBackupManifest,
) {
  const config = validateConfig(rawConfig);
  let phaseName = 'gitPreflight';
  let previousSha;
  let targetSha;
  const journal = (status) => record(config, { status, phase: phaseName, previousSha, targetSha });
  try {
    const git = (...args) =>
      run('git', ['-C', config.checkout, ...args], { label: `git ${args[0]}` });
    const branch = git('symbolic-ref', '--quiet', '--short', 'HEAD');
    if (branch !== 'main') throw new Error('BILLING_UPDATE_MAIN_REQUIRED');
    if (git('status', '--porcelain', '--untracked-files=normal'))
      throw new Error('BILLING_UPDATE_CHECKOUT_NOT_CLEAN');
    previousSha = git('rev-parse', 'HEAD');
    if (!SHA.test(previousSha)) throw new Error('BILLING_UPDATE_HEAD_INVALID');
    if (apply) git('fetch', '--no-tags', 'origin', 'main');
    targetSha = git('rev-parse', '--verify', 'refs/remotes/origin/main');
    if (!SHA.test(targetSha)) throw new Error('BILLING_UPDATE_TARGET_INVALID');
    if (targetSha.toLowerCase() !== config.approvedSha.toLowerCase())
      throw new Error('BILLING_UPDATE_MAIN_NOT_APPROVED');
    git('merge-base', '--is-ancestor', previousSha, targetSha);
    if (!apply) return { previousSha, targetSha, mode: 'CHECK_ONLY' };

    journal('STARTED');

    const phase = (name, extraArgs = []) => {
      phaseName = name;
      const command = config[name];
      return run(command.file, [...command.args, ...extraArgs], {
        label: name,
        cwd: config.checkout,
      });
    };
    phase('configurationCheck');
    // Backups and a scratch restore check must pass before the checkout changes.
    phase('migrationPreflight');
    const backupManifest = phase('backup');
    if (!path.isAbsolute(backupManifest || '') || /[\r\n\0]/.test(backupManifest))
      throw new Error('BILLING_UPDATE_BACKUP_MANIFEST_MISSING');
    verifyManifest(backupManifest);
    phase('restoreVerification', [backupManifest]);
    phaseName = 'checkoutUpdate';
    git('merge', '--ff-only', targetSha);
    phase('updateApi');
    phase('updateWorkers');
    phase('healthCheck');
    journal('SUCCEEDED');
    return { previousSha, targetSha, mode: 'UPDATED' };
  } catch (error) {
    if (apply) journal('FAILED');
    throw error;
  }
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
      let config;
      try {
        config = JSON.parse(readFileSync(DEFAULT_CONFIG, 'utf8'));
      } catch {
        throw new Error('BILLING_UPDATE_CONFIG_INVALID');
      }
      let lockFd;
      const lockPath = `${DEFAULT_CONFIG}.lock`;
      try {
        if (apply)
          lockFd = openSync(
            lockPath,
            constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
            0o600,
          );
        const result = runUpdate(config, execute, apply);
        process.stdout.write(JSON.stringify(result) + '\n');
      } finally {
        if (lockFd !== undefined) {
          closeSync(lockFd);
          unlinkSync(lockPath);
        }
      }
    }
  } catch (error) {
    process.stderr.write(`Billing update stopped: ${error.message}\n`);
    process.exitCode = 2;
  }
}
