export interface SecretProvider {
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
