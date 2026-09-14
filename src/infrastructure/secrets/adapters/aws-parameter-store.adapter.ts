import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteParameterCommand,
  GetParameterCommand,
  PutParameterCommand,
  SSMClient,
} from '@aws-sdk/client-ssm';
import { SecretProvider } from '../ports/secret-provider.port';

@Injectable()
export class AwsParameterStoreSecretProvider implements SecretProvider {
  private readonly client: SSMClient;
  private readonly parameterPrefix: string;

  constructor(private readonly configService: ConfigService) {
    const region = this.configService.get<string>('secrets.awsRegion') ?? 'us-east-1';
    this.parameterPrefix =
      this.configService.get<string>('secrets.ssmParameterPrefix') ?? '/billing';
    this.client = new SSMClient({ region });
  }

  /**
   * Retrieves a secret from AWS SSM Parameter Store with decryption (SecureString + KMS).
   * NFR-003: The secret value is never logged.
   */
  async getSecret(key: string): Promise<string> {
    const parameterName = `${this.parameterPrefix}/${key}`;

    const command = new GetParameterCommand({
      Name: parameterName,
      WithDecryption: true,
    });

    const response = await this.client.send(command);
    const value = response.Parameter?.Value;

    if (!value) {
      throw new Error(
        `Secret '${key}' not found in AWS SSM Parameter Store at path '${parameterName}'.`,
      );
    }

    // Never log value — only log the parameter path for debugging
    return value;
  }

  async storeSecret(key: string, value: string): Promise<void> {
    await this.client.send(
      new PutParameterCommand({
        Name: `${this.parameterPrefix}/${key}`,
        Value: value,
        Type: 'SecureString',
        Overwrite: true,
      }),
    );
  }

  async deleteSecret(key: string): Promise<void> {
    await this.client.send(new DeleteParameterCommand({ Name: `${this.parameterPrefix}/${key}` }));
  }
}
