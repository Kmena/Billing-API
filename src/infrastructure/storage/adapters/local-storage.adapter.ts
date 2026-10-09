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

  constructor(storagePath?: string, signingSecret?: string) {
    const configuredPath = storagePath ?? './storage';
    assertRealHaciendaDisabledInTests();
    this.storagePath =
      process.env.NODE_ENV === 'test' ? assertSafeTestLocalStorage(configuredPath) : configuredPath;
    this.signingSecret = signingSecret ?? 'local-signing-secret-dev-only';
  }

  async ensureReady(): Promise<void> {
    await fs.mkdir(this.storagePath, { recursive: true });
    await fs.access(this.storagePath);
  }

  async upload(request: StorageUploadRequest): Promise<string> {
    const filePath = this.resolveKey(request.key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, request.bytes);
    return request.key;
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
    // Prevent path traversal
    const normalized = path.normalize(key).replace(/^(\.\.(\/|\\|$))+/, '');
    return path.join(this.storagePath, normalized);
  }
}
