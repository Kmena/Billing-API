import { Injectable } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { StoragePort, StorageUploadRequest } from '../ports/storage.port';
import {
  assertRealHaciendaDisabledInTests,
  assertSafeTestLocalStorage,
} from '../test-storage-safety';

/**
 * LocalStorageAdapter — Filesystem-based storage for development without LocalStack.
 * NFR-009: Files are stored with integrity checks; signed URLs are HMAC-based.
 */
@Injectable()
export class LocalStorageAdapter implements StoragePort {
  private readonly storagePath: string;
  private readonly signingSecret: string;
  private readonly requiredMarker?: string;

  constructor(storagePath?: string, signingSecret?: string, requiredMarker?: string) {
    const configuredPath = storagePath ?? './storage';
    assertRealHaciendaDisabledInTests();
    this.storagePath =
      process.env.NODE_ENV === 'test' ? assertSafeTestLocalStorage(configuredPath) : configuredPath;
    this.signingSecret = signingSecret ?? 'local-signing-secret-dev-only';
    this.requiredMarker = requiredMarker;
  }

  async ensureReady(): Promise<void> {
    const root = await fs.stat(this.storagePath);
    if (!root.isDirectory()) {
      throw new Error(`Local fiscal storage root is not a directory: ${this.storagePath}`);
    }
    await fs.access(this.storagePath, fs.constants.R_OK | fs.constants.W_OK);

    if (this.requiredMarker) {
      const markerPath = path.join(this.storagePath, this.requiredMarker);
      const marker = await fs.stat(markerPath);
      if (!marker.isFile()) {
        throw new Error(`Local fiscal storage marker is not a file: ${markerPath}`);
      }
      await fs.access(markerPath, fs.constants.R_OK);
    }
  }

  async upload(request: StorageUploadRequest): Promise<string> {
    const filePath = this.resolveKey(request.key);
    const directory = path.dirname(filePath);
    await fs.mkdir(directory, { recursive: true });

    const existing = await this.readIfPresent(filePath);
    if (existing) {
      this.assertSameObject(request.key, existing, request.bytes);
      return request.key;
    }

    // Write and fsync a private sibling first. The canonical key is created with
    // an atomic hard-link, so a crash can leave only an ignorable temp file,
    // never a partially visible fiscal artifact or an overwritten object.
    const temporaryPath = path.join(
      directory,
      `.${path.basename(filePath)}.${crypto.randomUUID()}.tmp`,
    );
    let temporaryHandle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      temporaryHandle = await fs.open(temporaryPath, 'wx', 0o600);
      await temporaryHandle.writeFile(request.bytes);
      await temporaryHandle.sync();
      await temporaryHandle.close();
      temporaryHandle = undefined;

      try {
        await fs.link(temporaryPath, filePath);
        await this.syncDirectory(directory);
      } catch (error: unknown) {
        if (!this.hasCode(error, 'EEXIST')) throw error;
        const winner = await fs.readFile(filePath);
        this.assertSameObject(request.key, winner, request.bytes);
      }
      return request.key;
    } finally {
      await temporaryHandle?.close().catch(() => undefined);
      await fs.unlink(temporaryPath).catch((error: unknown) => {
        if (!this.hasCode(error, 'ENOENT')) throw error;
      });
    }
  }

  async download(key: string): Promise<Buffer> {
    const filePath = this.resolveKey(key);
    return fs.readFile(filePath);
  }

  async getSignedUrl(key: string, expiresInSeconds: number): Promise<string> {
    const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const signature = crypto
      .createHmac('sha256', this.signingSecret)
      .update(`${key}:${expiresAt}`)
      .digest('hex');

    // In a real local dev setup, this would be a URL to a local file server
    // For now, return a signed path that a local file server could validate
    return `local://storage/${key}?expires=${expiresAt}&sig=${signature}`;
  }

  async delete(key: string): Promise<void> {
    const filePath = this.resolveKey(key);
    await fs.unlink(filePath);
  }

  private resolveKey(key: string): string {
    if (!key || key.includes('\0') || path.isAbsolute(key)) {
      throw new Error('Local fiscal storage key must be a non-empty relative path.');
    }
    const root = path.resolve(this.storagePath);
    const candidate = path.resolve(root, key);
    const relative = path.relative(root, candidate);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Local fiscal storage key escapes the configured root.');
    }
    return candidate;
  }

  private async readIfPresent(filePath: string): Promise<Buffer | undefined> {
    try {
      return await fs.readFile(filePath);
    } catch (error: unknown) {
      if (this.hasCode(error, 'ENOENT')) return undefined;
      throw error;
    }
  }

  private assertSameObject(key: string, existing: Buffer, requested: Buffer): void {
    if (existing.equals(requested)) return;
    const error = new Error(
      `Refusing to overwrite immutable fiscal storage object '${key}'.`,
    ) as Error & { code: string };
    error.code = 'STORAGE_OBJECT_CONFLICT';
    throw error;
  }

  private async syncDirectory(directory: string): Promise<void> {
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      handle = await fs.open(directory, 'r');
      await handle.sync();
    } catch (error: unknown) {
      const code = this.errorCode(error);
      if (!['EINVAL', 'ENOTSUP', 'EISDIR', 'EPERM'].includes(code ?? '')) throw error;
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  private hasCode(error: unknown, expected: string): boolean {
    return this.errorCode(error) === expected;
  }

  private errorCode(error: unknown): string | undefined {
    return typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code)
      : undefined;
  }
}
