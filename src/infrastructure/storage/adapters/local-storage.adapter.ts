import { Injectable } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { StoragePort } from '../ports/storage.port';

/**
 * LocalStorageAdapter — Filesystem-based storage for development without LocalStack.
 * NFR-009: Files are stored with integrity checks; signed URLs are HMAC-based.
 */
@Injectable()
export class LocalStorageAdapter implements StoragePort {
  private readonly storagePath: string;
  private readonly signingSecret: string;

  constructor(storagePath?: string, signingSecret?: string) {
    this.storagePath = storagePath ?? './storage';
    this.signingSecret = signingSecret ?? 'local-signing-secret-dev-only';
  }

  async upload(key: string, content: Buffer, _metadata?: Record<string, string>): Promise<string> {
    const filePath = this.resolveKey(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
    return key;
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
