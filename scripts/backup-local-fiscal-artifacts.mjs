import { access, copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
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

function isWithin(child, parent) {
  const relation = relative(parent, child);
  return relation === '' || (!relation.startsWith(`..${sep}`) && relation !== '..' && !relation.includes(`..${sep}`));
}

async function files(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const result = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = resolve(current, entry.name);
    if (entry.isDirectory()) result.push(...await files(root, full));
    else if (entry.isFile()) result.push({ full, key: relative(root, full).split(sep).join('/') });
  }
  return result;
}

async function main() {
  const source = resolve(option('--source') ?? process.env.LOCAL_STORAGE_PATH ?? 'storage');
  const destinationOption = option('--destination');
  if (!destinationOption) throw new Error('Usage: npm run storage:backup -- --destination <new-backup-directory>');
  const destination = resolve(destinationOption);
  if (isWithin(destination, source) || isWithin(source, destination)) {
    throw new Error('Backup destination must be outside the active storage root');
  }
  if (!(await stat(source)).isDirectory()) throw new Error('Active storage root is not a directory');
  await access(source, fsConstants.R_OK);
  await mkdir(destination, { recursive: false });

  const entries = [];
  for (const file of await files(source)) {
    const destinationFile = resolve(destination, file.key);
    await mkdir(dirname(destinationFile), { recursive: true });
    await copyFile(file.full, destinationFile, fsConstants.COPYFILE_EXCL);
    const sourceBytes = await readFile(file.full);
    const backupBytes = await readFile(destinationFile);
    const sourceHash = sha256(sourceBytes);
    if (sourceHash !== sha256(backupBytes)) throw new Error(`Backup verification failed for ${file.key}`);
    entries.push({ storageKey: file.key, sizeBytes: sourceBytes.length, sha256: sourceHash });
  }

  const manifest = { version: 1, createdAt: new Date().toISOString(), sourceLabel: 'local-fiscal-storage', artifacts: entries };
  await writeFile(resolve(destination, manifestName), `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  console.log(`PASS backup verified: ${entries.length} files; manifest=${manifestName}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});