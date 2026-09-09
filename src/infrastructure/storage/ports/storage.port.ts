/**
 * StoragePort — Object storage abstraction.
 * NFR-009: Compatible with CR Reglamento de Comprobantes Electrónicos requirements
 * (integrity, accessibility, confidentiality, authenticity, queryability).
 * All stored objects are private by default — use signed URLs for access.
 */
export interface StoragePort {
  /**
   * Uploads content to object storage.
   * @param key Unique storage path/key (e.g., 'invoices/tenant-id/doc-key.xml')
   * @param content File content as Buffer
   * @param metadata Optional metadata to attach to the object
   * @returns The storage key (same as input key)
   */
  upload(key: string, content: Buffer, metadata?: Record<string, string>): Promise<string>;

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
