import { SetMetadata } from '@nestjs/common';

/** Metadata key used by ScopeGuard to read required scopes. */
export const SCOPES_KEY = 'required_scopes';

/**
 * @Scopes(...scopes) — Declare required API key scopes for an endpoint.
 * AND semantics: API key must possess ALL declared scopes (DEC-001).
 * Absence of scopes declaration → all authenticated principals allowed.
 *
 * Must only be used on routes protected by ApiKeyAuthGuard + ScopeGuard.
 */
export const Scopes = (...scopes: string[]) => SetMetadata(SCOPES_KEY, scopes);
