export const INVENTORI_FISCAL_PROFILE = 'inventori-fiscal-v1' as const;
export const INVENTORI_BOOTSTRAP_PROFILE = 'inventori-bootstrap-v1' as const;
export const INVENTORI_BOOTSTRAP_V1_SCOPES = ['fiscal-bootstrap:provision'] as const;

/**
 * Billing-owned, reviewed capability catalog for one bound company and one
 * API-key environment. Bootstrap/key administration is deliberately absent.
 */
export const INVENTORI_FISCAL_V1_SCOPES = [
  'fiscal-issuer:read',
  'fiscal-issuer:write',
  'fiscal-profile:read',
  'fiscal-profile:write',
  'fiscal-activities:read',
  'fiscal-activities:write',
  'fiscal-credentials:read',
  'fiscal-credentials:write',
  'fiscal-credentials:validate',
  'fiscal-certificates:read',
  'fiscal-certificates:write',
  'fiscal-issuance-points:read',
  'fiscal-issuance-points:write',
  'fiscal-sequences:read',
  'fiscal-sequences:write',
  'fiscal-readiness:read',
  'invoices:read',
  'invoices:write',
  'tickets:read',
  'tickets:write',
  'documents:read',
  'documents:write',
  'fiscal-deliveries:resend',
] as const;

export type InventoriFiscalV1Scope = (typeof INVENTORI_FISCAL_V1_SCOPES)[number];

export function scopesForIntegrationProfile(profile: string): string[] {
  if (profile === INVENTORI_FISCAL_PROFILE) return [...INVENTORI_FISCAL_V1_SCOPES];
  if (profile === INVENTORI_BOOTSTRAP_PROFILE) return [...INVENTORI_BOOTSTRAP_V1_SCOPES];
  throw new Error('UNSUPPORTED_INTEGRATION_PROFILE');
}
