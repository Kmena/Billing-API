import { Injectable } from '@nestjs/common';
import { SecretProvider } from '../ports/secret-provider.port';

@Injectable()
export class EnvSecretProvider implements SecretProvider {
  private readonly inMemoryStore = new Map<string, string>();

  async getSecret(key: string): Promise<string> {
    const value = this.inMemoryStore.get(key) ?? process.env[key];
    if (value === undefined || value === '') {
      throw new Error(
        `Secret '${key}' is not defined. Set the environment variable '${key}' before starting the application.`,
      );
    }
    return value;
  }

  async storeSecret(key: string, value: string): Promise<void> {
    this.inMemoryStore.set(key, value);
  }

  async deleteSecret(key: string): Promise<void> {
    this.inMemoryStore.delete(key);
  }
}
