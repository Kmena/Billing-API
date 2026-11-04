import { HaciendaApiAdapter } from '../../../../infrastructure/integrations/hacienda/adapters/hacienda-api.adapter';
import { MockHaciendaAdapter } from '../../../../infrastructure/integrations/hacienda/adapters/mock-hacienda.adapter';
import { HaciendaPort } from '../../../../infrastructure/integrations/hacienda/ports/hacienda.port';
import { isSafeSpec09ExternalMode } from '../../../../infrastructure/storage/spec09-stag-safety';

export const SPEC09_TAXPAYER_LOOKUP = Symbol('SPEC09_TAXPAYER_LOOKUP');
export type Spec09TaxpayerLookup = Pick<HaciendaPort, 'getTaxpayer'> | null;

/** The installed sandbox may enable only the public taxpayer lookup, never issuance. */
export function selectSpec09TaxpayerLookup(
  real: HaciendaApiAdapter,
  fixture: MockHaciendaAdapter,
): Spec09TaxpayerLookup {
  const mode = process.env.SPEC09_TAXPAYER_LOOKUP_MODE ?? 'disabled';
  if (mode === 'disabled') return null;
  if (mode === 'fixture') {
    if (process.env.NODE_ENV !== 'test' || process.env.BILLING_SPEC09_PERSISTENT_SANDBOX === 'true')
      throw new Error('SPEC09_TAXPAYER_FIXTURE_GUARD');
    return fixture;
  }
  if (
    mode !== 'public' ||
    process.env.NODE_ENV !== 'test' ||
    process.env.BILLING_SPEC09_PERSISTENT_SANDBOX !== 'true' ||
    process.env.SPEC09_SANDBOX_MARKER !== 'billing-spec09-synthetic-v1' ||
    !isSafeSpec09ExternalMode(process.env) ||
    (process.env.HACIENDA_API_BASE_URL ?? 'https://api.hacienda.go.cr') !==
      'https://api.hacienda.go.cr'
  )
    throw new Error('SPEC09_TAXPAYER_PUBLIC_GUARD');
  return real;
}
