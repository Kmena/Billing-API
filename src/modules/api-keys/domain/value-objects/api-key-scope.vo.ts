import { DomainException } from '../../../shared/domain/domain-exception';

/**
 * FR-012: Allowed API key scopes (exhaustive list).
 * DEC-001: AND semantics — all declared scopes must be present.
 */
export const ALLOWED_API_KEY_SCOPES = [
  'taxpayers:read',
  'cabys:read',
  'exchange-rates:read',
  // P0: Inventori fiscal onboarding — Company-scoped taxpayer & activity management
  // DEC-007: fiscal-onboarding scopes are P0 (moved from P1 by human decision)
  'fiscal-onboarding:read',
  'fiscal-onboarding:write',
  // Hacienda credential management for trusted M2M fiscal onboarding clients.
  'fiscal-credentials:write',
  'fiscal-credentials:validate',
  // Fase 2+ stubs — reserved but not yet active
  'invoices:read',
  'invoices:write',
  'tickets:read',
  'tickets:write',
  'documents:read',
  'documents:write',
] as const;

export type ApiKeyScope = (typeof ALLOWED_API_KEY_SCOPES)[number];

export class InvalidApiKeyScopeException extends DomainException {
  readonly code = 'INVALID_API_KEY_SCOPE';
  readonly httpStatus = 422;

  constructor(scopes: string[]) {
    super(
      `Invalid API key scope(s): ${scopes.join(', ')}. Allowed scopes: ${ALLOWED_API_KEY_SCOPES.join(', ')}`,
    );
  }
}

export function validateApiKeyScopes(scopes: string[]): void {
  const invalid = scopes.filter((s) => !ALLOWED_API_KEY_SCOPES.includes(s as ApiKeyScope));
  if (invalid.length > 0) {
    throw new InvalidApiKeyScopeException(invalid);
  }
}
