export interface SecretProvider {
  /**
   * Retrieves a secret by key.
   * @throws Error if the secret does not exist or cannot be retrieved.
   * The secret value is NEVER logged, even in debug mode.
   */
  getSecret(key: string): Promise<string>;
}

export const SECRET_PROVIDER = Symbol('SecretProvider');
