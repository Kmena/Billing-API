# Fiscal idempotency migration reconciliation

Date: 2026-10-11  
Scope: migrations `20261103000000`, `20261109000000`, and `20261110000000`  
Status: repository correction validated; normal database unchanged

## Historical evidence

The normal Billing database was inspected inside an explicit read-only transaction. It records migration A, `20261103000000_fix_idempotency_api_key_rotation`, as completed once with checksum `0a7050dbd1bf9cd640dc43e44f00ff3880179da0f6cac5d0a2c30054160ca53a`. The compatibility migration is also completed once with checksum `ba83a2f5b050ecdd6a46905af4c5f7ae76195f2c1d5f4009f6a1b1e4710cf36d`. Migration B is not applied there.

The exact SQL bytes for A were not recovered. An unreachable Git stash contains a migration with the same name (Git blob `aafb5b9826eeb7c7479822024f58a631a19f6f03`, SHA-256 `a00af73b8fdca412315c6423551c6fd649e7fd473444693dbcbd85f44c96012d`), but its digest does not match the database checksum. It is evidence of an A-shaped state only and is not authoritative. All reachable and unreachable Git blobs, local project/attachment evidence, migration manifests, and active API/worker image migration directories were checked; none matched the database checksum. No replacement or fabricated A artifact was added.

The observed database contains the exact key-scoped unique index on `(tenant_id, company_id, api_key_id, operation, key)`. Because the compatibility migration accepts only an exact stable logical index or that exact key-scoped index and completed successfully after A, the history proves a recognized transition state. It does not prove A's complete SQL semantics.

## Schema comparison

| Property | Actual normal database | Required after B | Result |
|---|---|---|---|
| Logical uniqueness | Includes `api_key_id` | Excludes `api_key_id` | B is required |
| API-key audit | Nullable FK with `ON DELETE SET NULL` | Same column/FK plus non-unique audit index | Preserved |
| Tenant isolation | `tenant_id` in unique key | Same | Preserved |
| Company isolation | `company_id` in unique key | Same | Preserved |
| Operation isolation | `operation` in unique key | Same | Preserved |
| Idempotency-key isolation | `key` in unique key | Same | Preserved |
| Rotation behavior | Old and new keys may reserve the same logical request | One reservation across rotation | Corrected by B |

## Selected forward-only strategy

Preserve A's applied metadata and preserve the already-applied compatibility migration. Do not add a reconstructed A, delete migration records, rewrite checksums, or use `migrate resolve`. Keep pending B and make it fail-closed and safely conditional:

1. Begin an explicit transaction and acquire `SHARE ROW EXCLUSIVE` on `fiscal_idempotency_keys`.
2. Accept exactly one of the exact known key-scoped or stable-logical index definitions.
3. Reject missing, simultaneous, partial, predicate-bearing, reordered, or otherwise unexpected definitions.
4. Check for duplicate stable logical identities before any DDL.
5. Replace the key-scoped index with stable uniqueness when necessary.
6. Preserve `api_key_id` as audit provenance and add its non-unique lookup index.
7. Verify the exact final index postcondition before commit.

This is alternative B from the reconciliation review. B is not redundant: without it, API-key rotation can create two logical reservations. The compatibility migration remains historically required and safe for its two exact recognized inputs; it performs no row DML. Direct A-shaped stable state to the hardened B is also safe because B recognizes the already-stable definition.

## Executed disposable evidence

- Sanitized logical restore from read-only `pg_dump`: 5 reservations, 2 accepted fiscal documents, 1 sequence, 0 duplicate logical groups.
- Before/after document identity fingerprint: `eb90f548b8c727456f06371f3c07ea71`.
- Before/after sequence fingerprint: `998e0217b1c268d72b3f0c28cf5fc63b`.
- Before/after reservation fingerprint: `2c566afb894d5dd8aef790e08623d784`.
- B checksum applied to the clone: `ea43d0566814497ae1bd0ca5b37905c6d9215098f90cf33046897b26ec9dd7cf`.
- Focused migration paths: 3/3 passed (key-scoped historical state, already-stable state, conflicting duplicates fail closed transactionally).
- Full disposable E2E: 25/25 suites and 150/150 tests passed.
- Full unit regression: 107/107 executed suites, 1,255 passed, 13 explicitly skipped, 0 failed.
- Full lint: 0 errors and 22 pre-existing test warnings.
- Prisma validate, typecheck, and build: exit 0.

The first full E2E rerun exposed a test isolation defect: the conflicting-duplicate rehearsal intentionally left the shared disposable database in the key-scoped state. A `finally` restoration now removes only the synthetic conflict rows, restores the stable index, and reapplies B in the disposable database. The subsequent complete run passed 150/150.

## Controlled migration prerequisites

Before applying B to a normal environment, an authorized operator must:

1. capture and approve a database backup/restore point;
2. repeat the read-only duplicate, relationship, identity, sequence, and exact-index preflight;
3. verify A and compatibility metadata/checksums remain unchanged and B is still pending;
4. use a controlled migration window with concurrent fiscal issuance stopped;
5. apply the repository-reviewed B checksum shown above through the approved deployment pipeline;
6. verify exact final indexes, reservations, mappings, claves, consecutives, sequences, and application replay behavior;
7. forward-repair only if a postcondition fails—never reactivate key-scoped uniqueness, delete reservations, or rewrite migration metadata.

Exact A remains a provenance limitation for historical reconstruction, but it is not substituted or concealed. The verified current state plus fail-closed forward migration is ready for controlled DBA migration review; it is not deployment authorization.
