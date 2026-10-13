/**
 * StoragePort — Object storage abstraction.
 * NFR-009: Compatible with CR Reglamento de Comprobantes Electrónicos requirements
 * (integrity, accessibility, confidentiality, authenticity, queryability).
 * All stored objects are private by default — use signed URLs for access.
 */
export interface StorageUploadRequest {
  readonly key: string;
  readonly bytes: Buffer;
  readonly contentType: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface StoragePort {
  /**
   * Verifies that the configured backing store is available before fiscal
   * processing records any attempt or writes immutable evidence.
   */
  ensureReady(): Promise<void>;

  /**
   * Uploads content to object storage.
   * Content type is authoritative transport metadata and is intentionally
   * separate from custom object metadata.
   * @returns The storage key (same as input key)
   */
  upload(request: StorageUploadRequest): Promise<string>;

  /**
   * Downloads an object from storage.
   * @throws Error if the object does not exist
   */
  download(key: string): Promise<Buffer>;

  /**
   * Generates a pre-signed URL for time-limited private access.
   * @param key The storage key
   * @param expiresInSeconds URL validity period in seconds
   */
  getSignedUrl(key: string, expiresInSeconds: number): Promise<string>;

  /**
   * Permanently deletes an object from storage.
   * Use with caution — irreversible.
   */
  delete(key: string): Promise<void>;
}

export const STORAGE_PORT = Symbol('StoragePort');
