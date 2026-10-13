import { Injectable } from '@nestjs/common';
import { constants as fsConstants, Stats } from 'fs';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { SecretProvider } from '../ports/secret-provider.port';

const FORMAT_VERSION = 1;
const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const LOCK_WAIT_MS = 25;
const LOCK_TIMEOUT_MS = 5_000;
const STALE_LOCK_MS = 30_000;
const KEY_CHECK_VALUE = 'billing-local-secret-store-key-check-v1';
const REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,499}$/;

interface EncryptedPayload {
  algorithm: typeof ALGORITHM;
  keyId: string;
  iv: string;
  authTag: string;
  ciphertext: string;
}

interface StoreMarker {
  formatVersion: typeof FORMAT_VERSION;
  storeId: string;
  createdAt: string;
  keyCheck: EncryptedPayload;
}

interface SecretVersionMetadata {
  version: number;
  createdAt: string;
  operation: 'WRITE' | 'DELETE';
  fileName: string;
  recordSha256: string;
}

interface SecretMetadata {
  formatVersion: typeof FORMAT_VERSION;
  referenceFingerprint: string;
  currentVersion: number;
  deleted: boolean;
  updatedAt: string;
  versions: SecretVersionMetadata[];
}

interface SecretRecord extends EncryptedPayload {
  formatVersion: typeof FORMAT_VERSION;
  referenceFingerprint: string;
  version: number;
  createdAt: string;
  operation: 'WRITE' | 'DELETE';
}

export interface EncryptedFileSecretProviderOptions {
  rootPath: string;
  masterKeyPath: string;
  requiredMarker?: string;
}

export interface InitializeEncryptedFileSecretStoreOptions extends EncryptedFileSecretProviderOptions {
  masterKey?: Buffer;
}

export class LocalSecretStoreError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'LocalSecretStoreError';
  }
}

/**
 * Durable local SecretProvider.
 *
 * Values are encrypted independently with AES-256-GCM and authenticated
 * reference/version metadata as AAD. The master key is read from a separate
 * read-only mount and is never stored below the encrypted-data root.
 */
@Injectable()
export class EncryptedFileSecretProvider implements SecretProvider {
  readonly isDurable = true;
  readonly providerId = 'local-encrypted-v1';

  private readonly rootPath: string;
  private readonly masterKeyPath: string;
  private readonly markerName: string;

  constructor(options: EncryptedFileSecretProviderOptions) {
    this.rootPath = path.resolve(options.rootPath);
    this.masterKeyPath = path.resolve(options.masterKeyPath);
    this.markerName = options.requiredMarker ?? '.billing-secret-store-root';
    this.assertSafeMarkerName(this.markerName);
    this.assertKeyOutsideStore();
  }

  async ensureReady(): Promise<void> {
    const root = await this.requireDirectory(this.rootPath, 'SECRET_STORE_MISSING');
    try {
      await fs.access(this.rootPath, fsConstants.R_OK | fsConstants.W_OK);
    } catch {
      throw new LocalSecretStoreError(
        'SECRET_STORE_READ_ONLY',
        'Secret store is not readable and writable.',
      );
    }
    await this.assertPrivateMode(root.mode, true);

    const key = await this.loadMasterKey();
    const marker = await this.loadMarker();
    this.assertKeyCheck(marker, key);
    await this.assertWritable();
    await this.verifyAllSecrets();
  }

  async getSecret(reference: string): Promise<string> {
    const normalized = this.normalizeReference(reference);
    const fingerprint = this.fingerprint(normalized);
    const metadata = await this.readMetadata(fingerprint);
    if (!metadata || metadata.deleted) {
      throw new LocalSecretStoreError('SECRET_NOT_FOUND', 'Secret material is not available.');
    }
    const version = metadata.versions.find((entry) => entry.version === metadata.currentVersion);
    if (!version || version.operation !== 'WRITE') {
      throw new LocalSecretStoreError('SECRET_METADATA_CORRUPT', 'Secret metadata is invalid.');
    }
    const recordBytes = await this.readVersionBytes(fingerprint, version.fileName);
    if (this.sha256(recordBytes) !== version.recordSha256) {
      throw new LocalSecretStoreError(
        'SECRET_INTEGRITY_FAILED',
        'Secret integrity verification failed.',
      );
    }
    const record = this.parseJson<SecretRecord>(recordBytes, 'SECRET_RECORD_CORRUPT');
    this.assertRecord(record, fingerprint, version);
    const key = await this.loadMasterKey();
    return this.decryptRecord(record, key);
  }

  async storeSecret(reference: string, value: string): Promise<void> {
    if (!value) {
      throw new LocalSecretStoreError('SECRET_VALUE_EMPTY', 'Secret value must not be empty.');
    }
    await this.writeVersion(reference, value, 'WRITE');
  }

  async deleteSecret(reference: string): Promise<void> {
    await this.writeVersion(reference, KEY_CHECK_VALUE, 'DELETE');
  }

  /** Deep validation used by backup/restore tooling and isolated tests. */
  async verifyAllSecrets(): Promise<{ active: number; deleted: number; versions: number }> {
    const key = await this.loadMasterKey();
    const marker = await this.loadMarker();
    this.assertKeyCheck(marker, key);
    const metadataFiles = await this.metadataFiles();
    let active = 0;
    let deleted = 0;
    let versions = 0;
    for (const metadataPath of metadataFiles) {
      const metadata = this.parseJson<SecretMetadata>(
        await fs.readFile(metadataPath),
        'SECRET_METADATA_CORRUPT',
      );
      this.assertMetadata(metadata);
      for (const version of metadata.versions) {
        const bytes = await fs.readFile(path.join(path.dirname(metadataPath), version.fileName));
        if (this.sha256(bytes) !== version.recordSha256) {
          throw new LocalSecretStoreError(
            'SECRET_INTEGRITY_FAILED',
            'Secret integrity verification failed.',
          );
        }
        const record = this.parseJson<SecretRecord>(bytes, 'SECRET_RECORD_CORRUPT');
        this.assertRecord(record, metadata.referenceFingerprint, version);
        this.decryptRecord(record, key);
        versions += 1;
      }
      if (metadata.deleted) deleted += 1;
      else active += 1;
    }
    return { active, deleted, versions };
  }

  private async writeVersion(
    reference: string,
    value: string,
    operation: 'WRITE' | 'DELETE',
  ): Promise<void> {
    const normalized = this.normalizeReference(reference);
    const fingerprint = this.fingerprint(normalized);
    const directory = this.secretDirectory(fingerprint);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await this.withLock(directory, async () => {
      const key = await this.loadMasterKey();
      const marker = await this.loadMarker();
      this.assertKeyCheck(marker, key);
      const existing = await this.readMetadata(fingerprint);
      const diskVersion = await this.maximumVersionOnDisk(directory);
      const nextVersion = Math.max(existing?.currentVersion ?? 0, diskVersion) + 1;
      const createdAt = new Date().toISOString();
      const record = this.encryptRecord(
        operation === 'WRITE' ? value : KEY_CHECK_VALUE,
        key,
        fingerprint,
        nextVersion,
        createdAt,
        operation,
      );
      const fileName = `v${String(nextVersion).padStart(8, '0')}.json`;
      const recordBytes = Buffer.from(`${JSON.stringify(record)}\n`, 'utf8');
      await this.writeAtomic(path.join(directory, fileName), recordBytes, false);
      const versionMetadata: SecretVersionMetadata = {
        version: nextVersion,
        createdAt,
        operation,
        fileName,
        recordSha256: this.sha256(recordBytes),
      };
      const metadata: SecretMetadata = {
        formatVersion: FORMAT_VERSION,
        referenceFingerprint: fingerprint,
        currentVersion: nextVersion,
        deleted: operation === 'DELETE',
        updatedAt: createdAt,
        versions: [...(existing?.versions ?? []), versionMetadata],
      };
      await this.writeAtomic(
        path.join(directory, 'metadata.json'),
        Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`, 'utf8'),
        true,
      );
    });
  }

  private encryptRecord(
    value: string,
    key: Buffer,
    referenceFingerprint: string,
    version: number,
    createdAt: string,
    operation: 'WRITE' | 'DELETE',
  ): SecretRecord {
    const iv = crypto.randomBytes(IV_BYTES);
    const aad = this.recordAad(referenceFingerprint, version, createdAt, operation);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return {
      formatVersion: FORMAT_VERSION,
      referenceFingerprint,
      version,
      createdAt,
      operation,
      algorithm: ALGORITHM,
      keyId: this.keyId(key),
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
  }

  private decryptRecord(record: SecretRecord, key: Buffer): string {
    if (record.keyId !== this.keyId(key)) {
      throw new LocalSecretStoreError('SECRET_MASTER_KEY_MISMATCH', 'Secret master key mismatch.');
    }
    try {
      const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(record.iv, 'base64'));
      decipher.setAAD(
        this.recordAad(
          record.referenceFingerprint,
          record.version,
          record.createdAt,
          record.operation,
        ),
      );
      decipher.setAuthTag(Buffer.from(record.authTag, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(record.ciphertext, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch (error: unknown) {
      if (error instanceof LocalSecretStoreError) throw error;
      throw new LocalSecretStoreError(
        'SECRET_DECRYPTION_FAILED',
        'Secret decryption or integrity verification failed.',
      );
    }
  }

  private async loadMasterKey(): Promise<Buffer> {
    let bytes: Buffer;
    try {
      const stat = await fs.stat(this.masterKeyPath);
      if (!stat.isFile()) throw new Error('not-file');
      await this.assertPrivateMode(stat.mode, false);
      bytes = await fs.readFile(this.masterKeyPath);
    } catch (error: unknown) {
      if (error instanceof LocalSecretStoreError) throw error;
      throw new LocalSecretStoreError(
        'SECRET_MASTER_KEY_UNAVAILABLE',
        'Secret master key is unavailable.',
      );
    }
    if (bytes.length === KEY_BYTES) return bytes;
    const text = bytes.toString('utf8').trim();
    if (/^[a-f0-9]{64}$/i.test(text)) return Buffer.from(text, 'hex');
    const decoded = Buffer.from(text, 'base64');
    if (
      decoded.length === KEY_BYTES &&
      decoded.toString('base64').replace(/=+$/, '') === text.replace(/=+$/, '')
    ) {
      return decoded;
    }
    throw new LocalSecretStoreError(
      'SECRET_MASTER_KEY_INVALID',
      'Secret master key must contain exactly 32 random bytes.',
    );
  }

  private async loadMarker(): Promise<StoreMarker> {
    try {
      const bytes = await fs.readFile(path.join(this.rootPath, this.markerName));
      const marker = this.parseJson<StoreMarker>(bytes, 'SECRET_STORE_MARKER_CORRUPT');
      if (
        marker.formatVersion !== FORMAT_VERSION ||
        !/^[a-f0-9-]{36}$/i.test(marker.storeId) ||
        !marker.createdAt ||
        !marker.keyCheck
      ) {
        throw new LocalSecretStoreError(
          'SECRET_STORE_MARKER_CORRUPT',
          'Secret-store marker is invalid.',
        );
      }
      return marker;
    } catch (error: unknown) {
      if (error instanceof LocalSecretStoreError) throw error;
      throw new LocalSecretStoreError(
        'SECRET_STORE_MARKER_MISSING',
        'Secret-store marker is unavailable.',
      );
    }
  }

  private assertKeyCheck(marker: StoreMarker, key: Buffer): void {
    if (marker.keyCheck.keyId !== this.keyId(key)) {
      throw new LocalSecretStoreError('SECRET_MASTER_KEY_MISMATCH', 'Secret master key mismatch.');
    }
    try {
      const decipher = crypto.createDecipheriv(
        ALGORITHM,
        key,
        Buffer.from(marker.keyCheck.iv, 'base64'),
      );
      decipher.setAAD(Buffer.from(`billing-secret-store-key-check:${marker.storeId}`, 'utf8'));
      decipher.setAuthTag(Buffer.from(marker.keyCheck.authTag, 'base64'));
      const value = Buffer.concat([
        decipher.update(Buffer.from(marker.keyCheck.ciphertext, 'base64')),
        decipher.final(),
      ]).toString('utf8');
      if (value !== KEY_CHECK_VALUE) throw new Error('mismatch');
    } catch {
      throw new LocalSecretStoreError(
        'SECRET_MASTER_KEY_MISMATCH',
        'Secret master key verification failed.',
      );
    }
  }

  private assertMetadata(metadata: SecretMetadata): void {
    const versionsValid =
      Array.isArray(metadata.versions) &&
      metadata.versions.length >= 1 &&
      metadata.versions.every(
        (version, index) =>
          version.version >= 1 &&
          (index === 0 || version.version > metadata.versions[index - 1].version) &&
          version.fileName === `v${String(version.version).padStart(8, '0')}.json` &&
          (version.operation === 'WRITE' || version.operation === 'DELETE') &&
          typeof version.createdAt === 'string' &&
          /^[a-f0-9]{64}$/.test(version.recordSha256),
      );
    const current = versionsValid ? metadata.versions[metadata.versions.length - 1] : undefined;
    if (
      metadata.formatVersion !== FORMAT_VERSION ||
      !/^[a-f0-9]{64}$/.test(metadata.referenceFingerprint) ||
      !Number.isInteger(metadata.currentVersion) ||
      metadata.currentVersion < 1 ||
      !versionsValid ||
      !current ||
      current.version !== metadata.currentVersion ||
      metadata.deleted !== (current.operation === 'DELETE')
    ) {
      throw new LocalSecretStoreError('SECRET_METADATA_CORRUPT', 'Secret metadata is invalid.');
    }
  }

  private assertRecord(
    record: SecretRecord,
    referenceFingerprint: string,
    version: SecretVersionMetadata,
  ): void {
    if (
      record.formatVersion !== FORMAT_VERSION ||
      record.algorithm !== ALGORITHM ||
      record.referenceFingerprint !== referenceFingerprint ||
      record.version !== version.version ||
      record.createdAt !== version.createdAt ||
      record.operation !== version.operation ||
      !record.iv ||
      !record.authTag ||
      !record.ciphertext
    ) {
      throw new LocalSecretStoreError('SECRET_RECORD_CORRUPT', 'Secret record is invalid.');
    }
  }

  private async readMetadata(fingerprint: string): Promise<SecretMetadata | undefined> {
    try {
      const metadata = this.parseJson<SecretMetadata>(
        await fs.readFile(path.join(this.secretDirectory(fingerprint), 'metadata.json')),
        'SECRET_METADATA_CORRUPT',
      );
      this.assertMetadata(metadata);
      if (metadata.referenceFingerprint !== fingerprint) {
        throw new LocalSecretStoreError('SECRET_METADATA_CORRUPT', 'Secret metadata is invalid.');
      }
      return metadata;
    } catch (error: unknown) {
      if (this.errorCode(error) === 'ENOENT') return undefined;
      throw error;
    }
  }

  private async readVersionBytes(fingerprint: string, fileName: string): Promise<Buffer> {
    if (!/^v\d{8}\.json$/.test(fileName)) {
      throw new LocalSecretStoreError('SECRET_METADATA_CORRUPT', 'Secret metadata is invalid.');
    }
    try {
      return await fs.readFile(path.join(this.secretDirectory(fingerprint), fileName));
    } catch {
      throw new LocalSecretStoreError('SECRET_RECORD_MISSING', 'Secret record is unavailable.');
    }
  }

  private async metadataFiles(): Promise<string[]> {
    const secretsRoot = path.join(this.rootPath, 'secrets');
    try {
      const prefixes = await fs.readdir(secretsRoot, { withFileTypes: true });
      const result: string[] = [];
      for (const prefix of prefixes) {
        if (!prefix.isDirectory() || !/^[a-f0-9]{2}$/.test(prefix.name)) continue;
        const prefixPath = path.join(secretsRoot, prefix.name);
        for (const entry of await fs.readdir(prefixPath, { withFileTypes: true })) {
          if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) continue;
          result.push(path.join(prefixPath, entry.name, 'metadata.json'));
        }
      }
      return result;
    } catch (error: unknown) {
      if (this.errorCode(error) === 'ENOENT') return [];
      throw error;
    }
  }

  private async maximumVersionOnDisk(directory: string): Promise<number> {
    const entries = await fs.readdir(directory);
    return entries.reduce((maximum, name) => {
      const match = /^v(\d{8})\.json$/.exec(name);
      return match ? Math.max(maximum, Number(match[1])) : maximum;
    }, 0);
  }

  private async withLock<T>(directory: string, operation: () => Promise<T>): Promise<T> {
    const lockPath = path.join(directory, '.write.lock');
    const started = Date.now();
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    while (!handle) {
      try {
        handle = await fs.open(lockPath, 'wx', 0o600);
        await handle.writeFile(`${process.pid}:${new Date().toISOString()}\n`, 'utf8');
        await handle.sync();
      } catch (error: unknown) {
        if (this.errorCode(error) !== 'EEXIST') throw error;
        const stat = await fs.stat(lockPath).catch(() => undefined);
        if (stat && Date.now() - stat.mtimeMs > STALE_LOCK_MS) {
          await fs.unlink(lockPath).catch(() => undefined);
          continue;
        }
        if (Date.now() - started >= LOCK_TIMEOUT_MS) {
          throw new LocalSecretStoreError('SECRET_STORE_BUSY', 'Secret store is busy.');
        }
        await new Promise((resolve) => setTimeout(resolve, LOCK_WAIT_MS));
      }
    }
    try {
      return await operation();
    } finally {
      await handle.close().catch(() => undefined);
      await fs.unlink(lockPath).catch(() => undefined);
    }
  }

  private async writeAtomic(destination: string, bytes: Buffer, replace: boolean): Promise<void> {
    const directory = path.dirname(destination);
    const temporary = path.join(
      directory,
      `.${path.basename(destination)}.${crypto.randomUUID()}.tmp`,
    );
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      handle = await fs.open(temporary, 'wx', 0o600);
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close();
      handle = undefined;
      if (!replace) {
        await fs.link(temporary, destination);
        await fs.unlink(temporary);
      } else {
        await fs.rename(temporary, destination);
      }
      await this.syncDirectory(directory);
    } finally {
      await handle?.close().catch(() => undefined);
      await fs.unlink(temporary).catch((error: unknown) => {
        if (this.errorCode(error) !== 'ENOENT') throw error;
      });
    }
  }

  private async assertWritable(): Promise<void> {
    const probe = path.join(this.rootPath, `.write-probe.${crypto.randomUUID()}.tmp`);
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      handle = await fs.open(probe, 'wx', 0o600);
      await handle.writeFile('probe', 'utf8');
      await handle.sync();
    } catch {
      throw new LocalSecretStoreError('SECRET_STORE_READ_ONLY', 'Secret store is not writable.');
    } finally {
      await handle?.close().catch(() => undefined);
      await fs.unlink(probe).catch(() => undefined);
    }
  }

  private async syncDirectory(directory: string): Promise<void> {
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      handle = await fs.open(directory, 'r');
      await handle.sync();
    } catch (error: unknown) {
      if (!['EINVAL', 'ENOTSUP', 'EISDIR', 'EPERM'].includes(this.errorCode(error) ?? '')) {
        throw error;
      }
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  private normalizeReference(reference: string): string {
    const normalized = String(reference ?? '').trim();
    if (
      !REFERENCE_PATTERN.test(normalized) ||
      normalized.includes('..') ||
      normalized.includes('//') ||
      normalized.includes('\\') ||
      path.isAbsolute(normalized)
    ) {
      throw new LocalSecretStoreError('SECRET_REFERENCE_INVALID', 'Secret reference is invalid.');
    }
    return normalized;
  }

  private secretDirectory(fingerprint: string): string {
    return path.join(this.rootPath, 'secrets', fingerprint.slice(0, 2), fingerprint);
  }

  private recordAad(
    fingerprint: string,
    version: number,
    createdAt: string,
    operation: 'WRITE' | 'DELETE',
  ): Buffer {
    return Buffer.from(
      JSON.stringify({ formatVersion: FORMAT_VERSION, fingerprint, version, createdAt, operation }),
      'utf8',
    );
  }

  private fingerprint(reference: string): string {
    return this.sha256(Buffer.from(reference, 'utf8'));
  }

  private keyId(key: Buffer): string {
    return this.sha256(key).slice(0, 16);
  }

  private sha256(bytes: Buffer): string {
    return crypto.createHash('sha256').update(bytes).digest('hex');
  }

  private parseJson<T>(bytes: Buffer, code: string): T {
    try {
      return JSON.parse(bytes.toString('utf8')) as T;
    } catch {
      throw new LocalSecretStoreError(code, 'Secret-store JSON is invalid.');
    }
  }

  private async requireDirectory(target: string, code: string): Promise<Stats> {
    try {
      const stat = await fs.stat(target);
      if (!stat.isDirectory()) throw new Error('not-directory');
      return stat;
    } catch {
      throw new LocalSecretStoreError(code, 'Secret-store root is unavailable.');
    }
  }

  private async assertPrivateMode(mode: number, directory: boolean): Promise<void> {
    if (process.platform === 'win32') return;
    if ((mode & 0o077) !== 0) {
      throw new LocalSecretStoreError(
        directory ? 'SECRET_STORE_PERMISSIONS_UNSAFE' : 'SECRET_MASTER_KEY_PERMISSIONS_UNSAFE',
        'Secret-store filesystem permissions are too broad.',
      );
    }
  }

  private assertSafeMarkerName(marker: string): void {
    if (!/^[A-Za-z0-9._-]+$/.test(marker)) {
      throw new LocalSecretStoreError(
        'SECRET_STORE_MARKER_INVALID',
        'Secret-store marker is invalid.',
      );
    }
  }

  private assertKeyOutsideStore(): void {
    const relation = path.relative(this.rootPath, this.masterKeyPath);
    if (relation === '' || (!relation.startsWith('..') && !path.isAbsolute(relation))) {
      throw new LocalSecretStoreError(
        'SECRET_MASTER_KEY_COLOCATED',
        'Secret master key must be stored outside the encrypted-data root.',
      );
    }
  }

  private errorCode(error: unknown): string | undefined {
    return typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code)
      : undefined;
  }
}

export async function initializeEncryptedFileSecretStore(
  options: InitializeEncryptedFileSecretStoreOptions,
): Promise<{ storeId: string; masterKeyCreated: boolean }> {
  const rootPath = path.resolve(options.rootPath);
  const masterKeyPath = path.resolve(options.masterKeyPath);
  const markerName = options.requiredMarker ?? '.billing-secret-store-root';
  const relation = path.relative(rootPath, masterKeyPath);
  if (relation === '' || (!relation.startsWith('..') && !path.isAbsolute(relation))) {
    throw new LocalSecretStoreError(
      'SECRET_MASTER_KEY_COLOCATED',
      'Secret master key must be stored outside the encrypted-data root.',
    );
  }
  if (!/^[A-Za-z0-9._-]+$/.test(markerName)) {
    throw new LocalSecretStoreError(
      'SECRET_STORE_MARKER_INVALID',
      'Secret-store marker is invalid.',
    );
  }
  const key = options.masterKey ?? crypto.randomBytes(KEY_BYTES);
  if (key.length !== KEY_BYTES) {
    throw new LocalSecretStoreError(
      'SECRET_MASTER_KEY_INVALID',
      'Secret master key must be 32 bytes.',
    );
  }
  await fs.mkdir(path.dirname(masterKeyPath), { recursive: true, mode: 0o700 });
  let rootCreated = false;
  let keyCreated = false;
  try {
    await fs.mkdir(rootPath, { recursive: false, mode: 0o700 });
    rootCreated = true;
    await fs.writeFile(masterKeyPath, key, { flag: 'wx', mode: 0o600 });
    keyCreated = true;
    const storeId = crypto.randomUUID();
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    cipher.setAAD(Buffer.from(`billing-secret-store-key-check:${storeId}`, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(KEY_CHECK_VALUE, 'utf8'), cipher.final()]);
    const marker: StoreMarker = {
      formatVersion: FORMAT_VERSION,
      storeId,
      createdAt: new Date().toISOString(),
      keyCheck: {
        algorithm: ALGORITHM,
        keyId: crypto.createHash('sha256').update(key).digest('hex').slice(0, 16),
        iv: iv.toString('base64'),
        authTag: cipher.getAuthTag().toString('base64'),
        ciphertext: ciphertext.toString('base64'),
      },
    };
    await fs.writeFile(path.join(rootPath, markerName), `${JSON.stringify(marker, null, 2)}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
    await fs.mkdir(path.join(rootPath, 'secrets'), { mode: 0o700 });
    return { storeId, masterKeyCreated: true };
  } catch (error: unknown) {
    if (keyCreated) await fs.unlink(masterKeyPath).catch(() => undefined);
    if (rootCreated) await fs.rm(rootPath, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}
