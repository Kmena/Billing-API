import { Injectable } from '@nestjs/common';
import { SecretProvider } from '../ports/secret-provider.port';

@Injectable()
export class EnvSecretProvider implements SecretProvider {
  /**
   * Reads a secret from environment variables.
   * @throws Error if the variable is not set.
   * NFR-003: Secret values are never logged.
   */
  async getSecret(key: string): Promise<string> {
    const value = process.env[key];

    if (value === undefined || value === '') {
      throw new Error(
        `Secret '${key}' is not defined. Set the environment variable '${key}' before starting the application.`,
      );
    }

    // Never log the value — only the key name for debugging purposes
    return value;
  }
}
