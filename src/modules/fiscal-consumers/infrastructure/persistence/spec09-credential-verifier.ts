import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { HaciendaOidcAuthAdapter } from '../../../hacienda-connection/infrastructure/auth/hacienda-oidc-auth.adapter';
import { MockHaciendaAuthAdapter } from '../../../hacienda-connection/infrastructure/auth/mock-hacienda-auth.adapter';
import { HaciendaAuthPort } from '../../../hacienda-connection/domain/ports/hacienda-auth.port';

export const SPEC09_CREDENTIAL_VERIFIER = Symbol('SPEC09_CREDENTIAL_VERIFIER');
export type Spec09CredentialVerifier = HaciendaAuthPort | null;

/** A narrow SANDBOX token check. The fiscal submission adapter remains disabled. */
export function selectSpec09CredentialVerifier(
  config: ConfigService,
  http: HttpService,
): Spec09CredentialVerifier {
  const mode = process.env.SPEC09_CREDENTIAL_VALIDATION_MODE ?? 'disabled';
  if (mode === 'disabled') return null;
  if (mode === 'fixture') {
    if (process.env.NODE_ENV !== 'test' || process.env.BILLING_SPEC09_PERSISTENT_SANDBOX === 'true')
      throw new Error('SPEC09_CREDENTIAL_FIXTURE_GUARD');
    return new MockHaciendaAuthAdapter();
  }
  if (
    mode !== 'sandbox' ||
    process.env.NODE_ENV !== 'test' ||
    process.env.BILLING_SPEC09_PERSISTENT_SANDBOX !== 'true' ||
    process.env.SPEC09_SANDBOX_MARKER !== 'billing-spec09-synthetic-v1' ||
    process.env.USE_REAL_HACIENDA !== 'false' ||
    (process.env.HACIENDA_IDP_SANDBOX_URL ??
      'https://idp.comprobanteselectronicos.go.cr/auth/realms/rut-stag/protocol/openid-connect/token') !==
      'https://idp.comprobanteselectronicos.go.cr/auth/realms/rut-stag/protocol/openid-connect/token' ||
    (process.env.HACIENDA_IDP_CLIENT_ID_SANDBOX ?? 'api-stag') !== 'api-stag'
  )
    throw new Error('SPEC09_CREDENTIAL_SANDBOX_GUARD');
  return new HaciendaOidcAuthAdapter(config, http);
}
