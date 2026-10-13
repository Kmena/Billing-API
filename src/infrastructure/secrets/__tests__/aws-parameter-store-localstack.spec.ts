import { ConfigService } from '@nestjs/config';
import { AwsParameterStoreSecretProvider } from '../adapters/aws-parameter-store.adapter';

const endpoint = process.env.AWS_SSM_ENDPOINT;
const describeIfLocalStack = endpoint ? describe : describe.skip;

function makeProvider(prefix: string): AwsParameterStoreSecretProvider {
  const config = {
    get: jest.fn((key: string) => {
      const values: Record<string, string | undefined> = {
        'secrets.awsRegion': process.env.AWS_REGION ?? 'us-east-1',
        'secrets.ssmEndpoint': endpoint,
        'secrets.ssmParameterPrefix': prefix,
      };
      return values[key];
    }),
  } as unknown as ConfigService;

  return new AwsParameterStoreSecretProvider(config);
}

describeIfLocalStack('AwsParameterStoreSecretProvider — LocalStack durability', () => {
  it('persists fiscal certificate secrets across provider instances', async () => {
    const prefix = `/billing/test/${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const key = 'fiscal-certs/company-1/sandbox/cert-sentinel';
    const value = JSON.stringify({ pkcs12Base64: Buffer.from('sentinel-p12').toString('base64') });

    const writer = makeProvider(prefix);
    await writer.storeSecret(key, value);

    // New client/provider instance: this is the important restart-ish bit.
    const reader = makeProvider(prefix);
    await expect(reader.getSecret(key)).resolves.toBe(value);

    await reader.deleteSecret(key);
    await expect(makeProvider(prefix).getSecret(key)).rejects.toThrow();
  });
});
