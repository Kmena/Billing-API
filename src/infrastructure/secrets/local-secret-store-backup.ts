import { constants as fsConstants } from 'fs';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { EncryptedFileSecretProvider } from './adapters/encrypted-file-secret-provider.adapter';

const MANIFEST_NAME = 'encrypted-secret-store-manifest.json';

interface BackupEntry {
  relativePath: string;
  sizeBytes: number;
  sha256: string;
}

interface BackupManifest {
  formatVersion: 1;
  createdAt: string;
  sourceLabel: 'billing-local-encrypted-secret-store';
  entries: BackupEntry[];
}

export interface BackupSecretStoreOptions {
  sourcePath: string;
  destinationPath: string;
}

export interface RestoreSecretStoreOptions {
  backupPath: string;
  destinationPath: string;
  masterKeyPath: string;
  requiredMarker?: string;
}

export async function backupEncryptedSecretStore(
  options: BackupSecretStoreOptions,
): Promise<{ files: number; manifestSha256: string }> {
  const source = path.resolve(options.sourcePath);
  const destination = path.resolve(options.destinationPath);
  assertSeparateRoots(source, destination);
  const sourceStat = await fs.stat(source);
  if (!sourceStat.isDirectory())
    throw new Error('Encrypted secret-store source is not a directory.');
  await fs.access(source, fsConstants.R_OK);
  await fs.mkdir(destination, { recursive: false, mode: 0o700 });

  const entries: BackupEntry[] = [];
  for (const file of await listStoreFiles(source)) {
    const destinationFile = safeResolve(destination, file.relativePath);
    await fs.mkdir(path.dirname(destinationFile), { recursive: true, mode: 0o700 });
    await fs.copyFile(file.absolutePath, destinationFile, fsConstants.COPYFILE_EXCL);
    await fs.chmod(destinationFile, 0o600).catch(() => undefined);
    const sourceBytes = await fs.readFile(file.absolutePath);
    const copiedBytes = await fs.readFile(destinationFile);
    const digest = sha256(sourceBytes);
    if (digest !== sha256(copiedBytes))
      throw new Error('Encrypted secret backup verification failed.');
    entries.push({
      relativePath: file.relativePath,
      sizeBytes: sourceBytes.length,
      sha256: digest,
    });
  }

  const manifest: BackupManifest = {
    formatVersion: 1,
    createdAt: new Date().toISOString(),
    sourceLabel: 'billing-local-encrypted-secret-store',
    entries,
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(destination, MANIFEST_NAME), manifestBytes, {
    flag: 'wx',
    mode: 0o600,
  });
  return { files: entries.length, manifestSha256: sha256(manifestBytes) };
}

export async function restoreEncryptedSecretStore(
  options: RestoreSecretStoreOptions,
): Promise<{ files: number; activeSecrets: number; deletedSecrets: number; versions: number }> {
  const backup = path.resolve(options.backupPath);
  const destination = path.resolve(options.destinationPath);
  assertSeparateRoots(backup, destination);
  const manifest = await loadManifest(backup);
  const actualFiles = (await listStoreFiles(backup)).filter(
    (entry) => entry.relativePath !== MANIFEST_NAME,
  );
  const expected = new Map(manifest.entries.map((entry) => [entry.relativePath, entry]));
  if (actualFiles.length !== expected.size)
    throw new Error('Encrypted secret backup is incomplete.');
  for (const file of actualFiles) {
    const entry = expected.get(file.relativePath);
    if (!entry) throw new Error('Encrypted secret backup contains an unexpected file.');
    const bytes = await fs.readFile(file.absolutePath);
    if (bytes.length !== entry.sizeBytes || sha256(bytes) !== entry.sha256) {
      throw new Error('Encrypted secret backup integrity verification failed.');
    }
  }

  await fs.mkdir(destination, { recursive: false, mode: 0o700 });
  for (const entry of manifest.entries) {
    const source = safeResolve(backup, entry.relativePath);
    const target = safeResolve(destination, entry.relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await fs.copyFile(source, target, fsConstants.COPYFILE_EXCL);
    await fs.chmod(target, 0o600).catch(() => undefined);
  }

  const provider = new EncryptedFileSecretProvider({
    rootPath: destination,
    masterKeyPath: options.masterKeyPath,
    requiredMarker: options.requiredMarker,
  });
  await provider.ensureReady();
  const verification = await provider.verifyAllSecrets();
  return {
    files: manifest.entries.length,
    activeSecrets: verification.active,
    deletedSecrets: verification.deleted,
    versions: verification.versions,
  };
}

async function loadManifest(backup: string): Promise<BackupManifest> {
  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(
      await fs.readFile(path.join(backup, MANIFEST_NAME), 'utf8'),
    ) as BackupManifest;
  } catch {
    throw new Error('Encrypted secret backup manifest is missing or corrupt.');
  }
  if (
    manifest.formatVersion !== 1 ||
    manifest.sourceLabel !== 'billing-local-encrypted-secret-store' ||
    !Array.isArray(manifest.entries) ||
    manifest.entries.some(
      (entry) =>
        !entry.relativePath ||
        entry.relativePath === MANIFEST_NAME ||
        !/^[a-f0-9]{64}$/.test(entry.sha256) ||
        !Number.isSafeInteger(entry.sizeBytes) ||
        entry.sizeBytes < 0,
    )
  ) {
    throw new Error('Encrypted secret backup manifest is invalid.');
  }
  return manifest;
}

async function listStoreFiles(
  root: string,
  current = root,
): Promise<Array<{ absolutePath: string; relativePath: string }>> {
  const result: Array<{ absolutePath: string; relativePath: string }> = [];
  for (const entry of (await fs.readdir(current, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const absolutePath = path.resolve(current, entry.name);
    const relativePath = path.relative(root, absolutePath).split(path.sep).join('/');
    if (entry.isSymbolicLink())
      throw new Error('Encrypted secret store must not contain symlinks.');
    if (entry.isDirectory()) {
      result.push(...(await listStoreFiles(root, absolutePath)));
    } else if (entry.isFile()) {
      if (/\.tmp$/.test(entry.name) || entry.name === '.write.lock') continue;
      if (/\.(?:key|pem|p12|pfx)$/i.test(entry.name) || /master.?key/i.test(entry.name)) {
        throw new Error(
          'Master key or private material must not be stored in the encrypted-data root.',
        );
      }
      result.push({ absolutePath, relativePath });
    }
  }
  return result;
}

function assertSeparateRoots(first: string, second: string): void {
  const relationA = path.relative(first, second);
  const relationB = path.relative(second, first);
  const insideA = relationA === '' || (!relationA.startsWith('..') && !path.isAbsolute(relationA));
  const insideB = relationB === '' || (!relationB.startsWith('..') && !path.isAbsolute(relationB));
  if (insideA || insideB)
    throw new Error('Secret backup and active store must use separate roots.');
}

function safeResolve(root: string, relativePath: string): string {
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.includes('\\')) {
    throw new Error('Encrypted secret backup path is invalid.');
  }
  const candidate = path.resolve(root, relativePath);
  const relation = path.relative(root, candidate);
  if (!relation || relation.startsWith('..') || path.isAbsolute(relation)) {
    throw new Error('Encrypted secret backup path escapes its root.');
  }
  return candidate;
}

function sha256(bytes: Buffer): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}
