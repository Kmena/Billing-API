import { ConfigService } from '@nestjs/config';
import { SecretProvider } from '../../../../infrastructure/secrets/ports/secret-provider.port';
import { NodemailerEmailDeliveryAdapter } from './nodemailer-email-delivery.adapter';

/** No process-environment or database copy of SMTP credentials is permitted. */
export async function createSmtpEmailDeliveryAdapter(
  config: ConfigService,
  secrets: SecretProvider,
): Promise<NodemailerEmailDeliveryAdapter> {
  const host = config.get<string>('SMTP_HOST');
  const fromAddress = config.get<string>('EMAIL_FROM_ADDRESS');
  if (!host || !fromAddress || !secrets.isDurable) {
    throw new Error('Secure SMTP configuration is incomplete.');
  }

  let auth: { user: string; password: string };
  try {
    const parsed: unknown = JSON.parse(await secrets.getSecret('SMTP_AUTH'));
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof (parsed as Record<string, unknown>).user !== 'string' ||
      typeof (parsed as Record<string, unknown>).password !== 'string'
    ) {
      throw new Error('invalid secret');
    }
    auth = parsed as { user: string; password: string };
  } catch {
    throw new Error('Secure SMTP credentials are unavailable.');
  }
  if (!auth.user || !auth.password) {
    throw new Error('Secure SMTP credentials are unavailable.');
  }
  return new NodemailerEmailDeliveryAdapter({
    host,
    port: config.get<number>('SMTP_PORT') ?? 587,
    secure: config.get<boolean>('SMTP_SECURE') ?? false,
    user: auth.user,
    password: auth.password,
    fromAddress,
    fromName: config.get<string>('EMAIL_FROM_NAME') ?? 'Billing Electrónico',
  });
}
