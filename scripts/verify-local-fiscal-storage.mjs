import { access, realpath, stat } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const marker = '.billing-fiscal-storage-root';
const containerRoot = '/var/lib/billing-artifacts';
const root = resolve(process.cwd(), 'storage');
const services = ['billing-api', 'billing-worker'];
const runtimeMode = process.argv.includes('--runtime');

function runDocker(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8' });
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.error?.message || `docker ${args.join(' ')} failed`;
    throw new Error(detail);
  }
  return result.stdout;
}

function environmentOf(value) {
  if (Array.isArray(value)) {
    return Object.fromEntries(value.map((entry) => {
      const index = entry.indexOf('=');
      return [entry.slice(0, index), entry.slice(index + 1)];
    }));
  }
  return value ?? {};
}

function assertStorageContract(name, environment, volumes, failures) {
  if (environment.STORAGE_TYPE !== 'local') {
    failures.push(`${name}: STORAGE_TYPE must be local`);
  }
  if (environment.LOCAL_STORAGE_PATH !== containerRoot) {
    failures.push(`${name}: LOCAL_STORAGE_PATH must be ${containerRoot}`);
  }
  if (environment.LOCAL_STORAGE_REQUIRED_MARKER !== marker) {
    failures.push(`${name}: required storage marker is missing or differs`);
  }
  const signingSecret = environment.LOCAL_STORAGE_SECRET;
  if (typeof signingSecret !== 'string' || signingSecret.length < 32 || signingSecret === 'local-signing-secret-dev-only') {
    failures.push(`${name}: LOCAL_STORAGE_SECRET must be an explicitly configured strong secret`);
  }

  const mount = volumes?.find((volume) =>
    (typeof volume === 'string' ? volume.endsWith(`:${containerRoot}`) : volume.target === containerRoot),
  );
  if (!mount) {
    failures.push(`${name}: missing bind mount to ${containerRoot}`);
    return;
  }
  if (typeof mount !== 'string') {
    const source = resolve(mount.source);
    if (source !== root) failures.push(`${name}: mount source differs from repository storage root`);
  }
}

async function main() {
  const failures = [];
  const rootInfo = await stat(root).catch(() => undefined);
  if (!rootInfo?.isDirectory()) failures.push('host storage root is missing or is not a directory');
  await access(root, fsConstants.R_OK | fsConstants.W_OK).catch(() => failures.push('host storage root is not read/write accessible'));
  await access(resolve(root, marker), fsConstants.R_OK).catch(() => failures.push('host storage marker is missing or unreadable'));

  const config = JSON.parse(runDocker(['compose', 'config', '--format', 'json']));
  const composeSecrets = [];
  for (const name of services) {
    const service = config.services?.[name];
    if (!service) {
      failures.push(`${name}: absent from effective Compose configuration`);
      continue;
    }
    const environment = environmentOf(service.environment);
    composeSecrets.push(environment.LOCAL_STORAGE_SECRET);
    assertStorageContract(name, environment, service.volumes, failures);
  }
  if (new Set(composeSecrets).size !== 1) {
    failures.push('billing-api and billing-worker must resolve the same LOCAL_STORAGE_SECRET');
  }

  if (runtimeMode) {
    const containers = JSON.parse(runDocker(['inspect', ...services.map((name) => `billing-${name.slice(8)}`)]));
    const runtimeSecrets = [];
    for (const container of containers) {
      const name = container.Name.slice(1);
      const mounts = container.Mounts.map((mount) => ({ source: mount.Source, target: mount.Destination }));
      const environment = environmentOf(container.Config.Env);
      runtimeSecrets.push(environment.LOCAL_STORAGE_SECRET);
      assertStorageContract(name, environment, mounts, failures);
    }
    if (new Set(runtimeSecrets).size !== 1) {
      failures.push('running billing-api and billing-worker must use the same LOCAL_STORAGE_SECRET');
    }
  }

  if (failures.length) {
    throw new Error(`Local fiscal storage preflight failed:\n- ${failures.join('\n- ')}`);
  }
  const canonicalRoot = await realpath(root);
  console.log(`PASS local fiscal storage preflight (${runtimeMode ? 'runtime' : 'compose'}): ${canonicalRoot}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
