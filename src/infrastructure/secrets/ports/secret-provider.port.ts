export interface SecretProvider {
  /**
   * True when secrets stored by this provider survive process restart.
   * Upload flows that create durable DB references must require this.
   */
  readonly isDurable: boolean;

  /** Stable, value-free provider identity for startup/runtime diagnostics. */
  readonly providerId?: string;

  /** Optional infrastructure preflight. Implementations must fail closed. */
  ensureReady?(): Promise<void>;

  /**
   * Retrieves a secret by key.
   * @throws Error if the secret does not exist or cannot be retrieved.
   * The secret value is NEVER logged, even in debug mode.
   */
  getSecret(key: string): Promise<string>;
  storeSecret(key: string, value: string): Promise<void>;
  deleteSecret(key: string): Promise<void>;
}

export const SECRET_PROVIDER = Symbol('SecretProvider');
