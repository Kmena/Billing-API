import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, relative, resolve, sep } from 'node:path';

const manifestName = 'fiscal-artifact-manifest.json';

function option(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function safeKey(key) {
  return typeof key === 'string' && key.length > 0 && !key.startsWith('/') && !key.split('/').includes('..');
}

function isWithin(child, parent) {
  const relation = relative(parent, child);
  return relation === '' || (!relation.startsWith(`..${sep}`) && relation !== '..' && !relation.includes(`..${sep}`));
}

async function main() {
  const sourceOption = option('--source');
  const destinationOption = option('--destination');
  if (!sourceOption || !destinationOption) {
    throw new Error('Usage: npm run storage:restore -- --source <backup-directory> --destination <new-isolated-directory>');
  }
  const source = resolve(sourceOption);
  const destination = resolve(destinationOption);
  const activeRoot = resolve(process.env.LOCAL_STORAGE_PATH ?? 'storage');
  if (isWithin(destination, activeRoot) || destination === activeRoot) {
    throw new Error('Restoration into the active storage root is forbidden');
  }
  await stat(source);
  await stat(destination).then(() => { throw new Error('Restore destination already exists; refusing to overwrite'); }).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  const manifest = JSON.parse(await readFile(resolve(source, manifestName), 'utf8'));
  if (manifest.version !== 1 || !Array.isArray(manifest.artifacts)) throw new Error('Invalid backup manifest');

  await mkdir(destination, { recursive: false });
  for (const artifact of manifest.artifacts) {
    if (!safeKey(artifact.storageKey) || !/^[a-f0-9]{64}$/.test(artifact.sha256) || !Number.isInteger(artifact.sizeBytes)) {
      throw new Error('Backup manifest contains an invalid artifact entry');
    }
    const sourceFile = resolve(source, artifact.storageKey);
    const destinationFile = resolve(destination, artifact.storageKey);
    if (!isWithin(destinationFile, destination)) throw new Error(`Unsafe storage key: ${artifact.storageKey}`);
    const bytes = await readFile(sourceFile);
    if (bytes.length !== artifact.sizeBytes || sha256(bytes) !== artifact.sha256) {
      throw new Error(`Source backup failed verification: ${artifact.storageKey}`);
    }
    await mkdir(dirname(destinationFile), { recursive: true });
    await copyFile(sourceFile, destinationFile, fsConstants.COPYFILE_EXCL);
    const restored = await readFile(destinationFile);
    if (sha256(restored) !== artifact.sha256) throw new Error(`Restore verification failed: ${artifact.storageKey}`);
  }
  console.log(`PASS isolated restore verified: ${manifest.artifacts.length} files`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});