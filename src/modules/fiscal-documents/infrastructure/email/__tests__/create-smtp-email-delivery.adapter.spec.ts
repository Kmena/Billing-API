import { ConfigService } from '@nestjs/config';
import { SecretProvider } from '../../../../../infrastructure/secrets/ports/secret-provider.port';
import { createSmtpEmailDeliveryAdapter } from '../create-smtp-email-delivery.adapter';
import { NodemailerEmailDeliveryAdapter } from '../nodemailer-email-delivery.adapter';

const config = {
  get: (key: string) =>
    ({
      SMTP_HOST: 'smtp.example.test',
      SMTP_PORT: 587,
      SMTP_SECURE: false,
      EMAIL_FROM_ADDRESS: 'billing@example.test',
    })[key],
} as ConfigService;

describe('secure SMTP bootstrap', () => {
  it('reads credentials only from a durable secret provider', async () => {
    const getSecret = jest.fn(async () =>
      JSON.stringify({ user: 'billing@example.test', password: 'synthetic-password' }),
    );
    const secrets = { isDurable: true, getSecret } as unknown as SecretProvider;
    const adapter = await createSmtpEmailDeliveryAdapter(config, secrets);
    expect(adapter).toBeInstanceOf(NodemailerEmailDeliveryAdapter);
    expect(getSecret).toHaveBeenCalledWith('SMTP_AUTH');
  });

  it('rejects an ephemeral provider before reading secrets', async () => {
    const getSecret = jest.fn();
    const secrets = { isDurable: false, getSecret } as unknown as SecretProvider;
    await expect(createSmtpEmailDeliveryAdapter(config, secrets)).rejects.toThrow(
      'Secure SMTP configuration is incomplete.',
    );
    expect(getSecret).not.toHaveBeenCalled();
  });

  it('does not propagate secret-provider error details', async () => {
    const secrets = {
      isDurable: true,
      getSecret: async () => {
        throw new Error('synthetic-sensitive-sentinel');
      },
    } as unknown as SecretProvider;
    await expect(createSmtpEmailDeliveryAdapter(config, secrets)).rejects.toThrow(
      'Secure SMTP credentials are unavailable.',
    );
  });
});
