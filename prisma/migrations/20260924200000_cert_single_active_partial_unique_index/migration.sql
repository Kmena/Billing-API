-- Migration: cert_single_active_partial_unique_index
-- DB-002: Enforce the domain invariant that at most ONE FiscalSigningCertificate
-- can be in ACTIVE status for any given (tenant_id, company_id, environment) combination.
--
-- Rationale:
--   The application upload/rotation flow uses an Prisma $transaction that:
--     1. Updates the existing ACTIVE cert to REPLACED
--     2. Inserts the new cert as ACTIVE
--   Under READ COMMITTED isolation (Prisma default), two concurrent transactions
--   can both read the initial state before either commits, then both attempt to
--   insert an ACTIVE cert. The first INSERT succeeds; the second is rejected by
--   this partial unique index with a P2002 error, which the application maps to
--   FISCAL_CERTIFICATE_CONCURRENT_ACTIVATION (HTTP 409).
--
-- Safety:
--   - Additive — no existing columns or data are removed.
--   - Conditional (WHERE status = 'ACTIVE') — non-ACTIVE rows are unaffected.
--   - If existing data violates the invariant (two ACTIVE rows for same scope),
--     the migration will fail with a duplicate key error. This would indicate
--     a data integrity issue requiring operator resolution before applying.
--   - The F4-S bootstrap row (with status = ACTIVE) is a single row per scope;
--     the constraint will be satisfied.
--
-- Index name: fiscal_signing_cert_one_active_per_scope

CREATE UNIQUE INDEX "fiscal_signing_cert_one_active_per_scope"
  ON "fiscal_signing_certificates" (tenant_id, company_id, environment)
  WHERE (status = 'ACTIVE');
