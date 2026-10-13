# Wave 2 Hacienda Credential Rotation Runbook

Status: validated with synthetic credentials and disposable PostgreSQL. Production execution requires the authorized Billing security/operations owner. Never record credential values in tickets, logs, commands, or evidence.

## Authority and scope

Only the privileged Billing bootstrap/operations authority may create or rotate Hacienda secret material. Every connection and secret reference is bound to tenant, company, and environment. `inventori-fiscal-v1` may consume readiness and issuance capabilities but cannot bootstrap or rotate credentials.

Approved durable secret storage is the production SSM/KMS configuration selected by Billing operations. Environment-backed/in-memory secrets are test/bootstrap only. Billing stores references, never credential values, in PostgreSQL.

## Rotation procedure

1. Record a change identifier, operator identity, tenant/company/environment, old reference fingerprint, and planned recovery window. Do not record values.
2. Confirm readiness and that no unresolved submission/delivery operation depends on an uncertain external result.
3. Store the replacement under a new immutable secret reference. Do not overwrite the old value in place.
4. Validate the replacement through the authorized sandbox/test adapter. Preparation alone does not change the active database reference.
5. Atomically update the company/environment connection to the new reference. Fiscal creation rechecks the exact eligible connection ID and reference inside its allocation transaction; an in-flight old proof fails before sequence allocation.
6. Verify readiness, one controlled synthetic retry, worker restart behavior, tenant/company/environment isolation, and absence of new/duplicate fiscal identities or sequence consumption.
7. Keep the old reference available only for the approved overlap required to drain operations that provably began before cutover. Never select it for new readiness or issuance.
8. Revoke/delete the old credential, verify it is unusable, and record value-free audit evidence.
9. Close the change only after API/worker health, logs, audit events, readiness, and pending-job state are reconciled.

## Failure and rollback

Before cutover, discard the replacement reference and keep the known-good current credential. After cutover, rollback means creating/validating another clean replacement and moving the database reference forward. Never reactivate a credential suspected compromised or already revoked. If the external result or active credential is uncertain, disable issuance for that company/environment and require manual review.

## Required evidence

- Change/approval identifier and operator.
- Tenant/company/environment and connection ID.
- Old/new reference fingerprints only.
- Preparation, cutover, readiness, retry, restart, revocation and isolation results.
- Fiscal-document and sequence counts before/after.
- Redacted logs and audit event IDs.

The 2026-10-11 disposable execution proved prepare/cutover/revocation/restart and isolation in 3/3 cases. It did not rotate production credentials or contact Hacienda.