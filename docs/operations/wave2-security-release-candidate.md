# Wave 2 security hardening and release candidate

Date: 2026-10-11 (America/Guatemala)  
Git revision: `3b0893fb02bbe0fb6e51ebcda795a7d1555f3820`  
Source state: dirty, provenance captured by exact effective-context hash  
Effective source SHA-256: `8a34a291a48d241a205f566b22b927fc03f1234665a74033241f20be7f05cff4`

## Decision

- `WAVE_2_TECHNICAL_CLOSURE = PASS`
- `WAVE_2_OPERATIONAL_CLOSURE = PASS` (revalidated with disposable infrastructure)
- `SECURITY_READINESS = PASS_WITH_DOCUMENTED_NON_REACHABLE_ADVISORIES`
- `PRODUCTION_AUTHORIZATION = BLOCKED`

Production authorization remains blocked until the business owner, security approver, database operator and fiscal operator approve the exact image digest, migration window, activation window, rollback and credential/configuration checklist. No deployment was performed.

## Audit method and scope

The audit was run freshly against the lockfile, the installed host tree and the production-pruned tree inside the candidate image. Source reachability was inspected for each critical/high advisory. The pre-remediation runtime result was 15 vulnerable package nodes (1 critical, 5 high, 8 moderate, 1 low). The release runtime result is 5 aggregate package nodes (0 critical, 1 high, 4 moderate) representing only two underlying advisories.

The full development tree still reports 59 aggregate nodes (1 critical, 45 high, 10 moderate, 3 low). Those nodes belong to build/test tooling and are not copied into the runtime image. The critical `handlebars@4.7.9` chain is `ts-jest@29.4.12 -> handlebars@4.7.9`; `npm ls handlebars --omit=dev` inside the candidate is empty. It is therefore excluded from runtime release risk, but remains a developer/CI toolchain modernization item. Tests compile only repository-controlled templates/source; no untrusted template is compiled in CI.

## Runtime advisory disposition

| Package and chain | Installed before → candidate | Advisory IDs | Severity | Runtime use and prerequisites | Disposition |
|---|---|---|---|---|---|
| `express -> proxy-addr` | 2.0.7 → 2.0.8 | GHSA-jqcg-44mw-7w3h / CVE-2026-90711 | Critical | Present in API. Exploit additionally requires a malformed IPv4-mapped IPv6 trust subnet. Billing does not enable Express `trust proxy`. | **REMEDIATED** with 2.0.8; absence of `trust proxy` was defense in depth. |
| `@nestjs/platform-express -> multer` | 2.0.2 → 2.4.0 | GHSA-xf7r-hgr6-v32p / CVE-2026-3304; GHSA-v52c-386h-88mc / CVE-2026-2359; GHSA-5528-5vmv-3xc2 / CVE-2026-3520; GHSA-72gw-mp4g-v24j / CVE-2026-5079; GHSA-3p4h-7m6x-2hcm / CVE-2026-5038; GHSA-wc9g-mqfw-jrwm / CVE-2026-77078; GHSA-qvfw-j98x-7q72 / CVE-2026-77063; GHSA-535w-7cp7-47q4 / CVE-2026-82333; plus GHSA-3pph-fpjx-jg34 in 2.2–2.3 | High/Moderate/Low | Reachable through certificate and logo multipart endpoints. Certificate writes require JWT + `TENANT_ADMIN`; logo upload requires API key scope/company isolation. File-size limits are present, but some DoS advisories had no workaround. | **REMEDIATED** with 2.4.0, same package major; upload regressions executed. |
| `@nestjs/swagger -> js-yaml` and `xmlbuilder2 -> js-yaml` | 4.1.0/4.3.2 → 4.3.2 | GHSA-mh29-5h37-fv8m / CVE-2025-64718; GHSA-h67p-54hq-rp68 / CVE-2026-53550; GHSA-52cp-r559-cp3m / CVE-2026-59869; GHSA-5p4m-2wfm-xmqj (no CVE assigned in advisory feed); GHSA-2883-xcg3-v3hh / CVE-2026-84375 | High/Moderate | Swagger is disabled in production; no application YAML parsing path accepts remote input. | **REMEDIATED** with 4.3.2. |
| `@nestjs/config/@nestjs/swagger -> lodash` | 4.17.21 → 4.18.1 | GHSA-r5fr-rjxr-66jc / CVE-2026-4800; GHSA-f23m-r3pf-42rh / CVE-2026-2950; GHSA-xxjr-mmjv-4gpg / CVE-2025-13465 | High/Moderate | Runtime transitive present; no application use of attacker-controlled `_.template` imports, `_.unset` or `_.omit`. | **REMEDIATED** with 4.18.1. |
| `@nestjs/common -> file-type` | 20.4.1 → 22.1.1 | GHSA-5v7r-6r5c-r473 / CVE-2026-31808; GHSA-j47w-4g3g-c36v / CVE-2026-32630 | Moderate | Nest loads `fileTypeFromBuffer` dynamically. Candidate runs Node 24; file-type 22 requires Node >=22 and retains that API. | **REMEDIATED**; compile, tests and runtime startup/recreation pass. |
| direct `joi` | 17.13.7 → 17.13.8 | GHSA-wr44-6hxh-3jwq / CVE-2026-90771 | Moderate | Used for startup configuration validation, not remotely supplied schemas/messages. | **REMEDIATED** with 17.13.8. |
| `@nestjs/platform-express -> body-parser` | 1.20.4 → 1.20.6 | GHSA-v422-hmwv-36x6 / CVE-2026-12590 | Low | HTTP parser runtime; Billing uses fixed numeric limits rather than attacker-controlled limit configuration. | **REMEDIATED** with 1.20.6. |
| `body-parser/express -> qs` | 6.14.2 → 6.16.0 | GHSA-q8mj-m7cp-5q26 / CVE-2026-8723; GHSA-x5fp-wj9c-mxmx / CVE-2026-82562; GHSA-4mjr-xmp4-gh2g / CVE-2026-82417 | Moderate | HTTP query/body transitive; remotely reachable parsing surface. | **REMEDIATED** with 6.16.0. |
| direct `node-forge` | 1.4.0 → 1.4.0 | GHSA-86w9-cpqp-85rv / CVE-2026-85393 | High | Package is used to decode PKCS#12 and convert key/certificate material. The vulnerable RSA PKCS#1 v1.5 **signature verification** API is not used. XML signing and verification use `node:crypto`; certificate upload is bounded and privileged. No patched node-forge release exists. | **NOT_REACHABLE_WITH_EVIDENCE / COMPENSATING CONTROL**. A regression test scans production TS and fails on forge/public-key verification APIs. Reassess immediately when a patched release exists or before adding any forge verification call. |
| direct `@nestjs/core` (aggregated through platform/swagger/terminus) | 10.4.22 → 10.4.22 | GHSA-36xv-jgw5-4q75 / CVE-2026-35515 | Moderate | Advisory requires application code to map attacker-influenced values into SSE `message.type` or `message.id`. Billing has no `@Sse` endpoint and no SSE message construction. Fix requires Nest 11.1.18+ and a coordinated framework major migration. | **NOT_REACHABLE_WITH_EVIDENCE / DEFERRED MAJOR UPGRADE**. Do not introduce SSE until Nest is upgraded. |

## node-forge fiscal-path verification

Production consumers are limited to:

- `NodeXadesEpesSignerAdapter`: ASN.1/PKCS#12 decode, bag extraction and PEM conversion. It signs with `crypto.sign` and verifies with `crypto.verify` plus `crypto.X509Certificate`.
- `CrCertificateIdentityExtractorService`: ASN.1/PKCS#12 decode, private-key/certificate bag extraction and fiscal identity OID parsing.

No production source references `forge.pki.rsa`, `forge.rsa`, `publicKey.verify` or `.publicKey.verify`. `node-forge-security-boundary.spec.ts` enforces that boundary. The focused signer/certificate/security run passed 54/54 tests. The remaining risk is library-level PKCS#12 parser exposure to a privileged, size-limited upload; this is not the vulnerable verification primitive and no exploit counterexample was demonstrated.

## Fresh validation evidence

| Gate | Result |
|---|---|
| Unit suite | 105 passed suites; 1,246 passed, 13 skipped, 0 failed |
| Full disposable E2E | 24 passed suites; 141/141 passed |
| Safety suite | 3 passed suites; 35/35 passed |
| Disposable DB safety | 2 passed suites; 8/8 passed |
| Consolidated fresh total | **1,430 passed, 13 skipped, 0 failed** |
| Static DB/storage safety check | PASS |
| Prisma validate | PASS |
| Typecheck | PASS |
| Full lint check | PASS with 0 errors and 22 pre-existing warnings in three test files |
| Build | PASS |
| Production runtime audit | 0 critical, 1 high compensated/non-reachable, 4 moderate aggregate nodes from one non-reachable SSE advisory |

No result from the previous 1,342-test baseline was reused.

## Release candidate and SBOM

- API tag: `billing-wave2-api-rc:8a34a291a48d`
- Worker tag: `billing-wave2-worker-rc:8a34a291a48d`
- Shared immutable image ID: `sha256:8ce179ebebcdb15aca1b11d757009c1e7da9f52ebe4e9c8602d250f144066ac1`
- OCI version: `wave2-security-rc-dirty-8a34a291a48d`
- OCI revision and content-hash labels match the values at the top of this report.
- SPDX JSON SBOM: `billing-wave2-security-rc-8a34a291a48d.spdx.json`
- SBOM SHA-256: `8a288b3fb63d5aa04e5eb9dbf92dd66518ef4cb7afc8ded4e169167fee4d7046`
- Secret-file scan: no `.env`, `.p12`, `.pfx`, `.key`, `.pem` or `.crt` files found under `/app`.

Disposable runtime validation started and recreated API and worker on a disposable PostgreSQL database and a shared synthetic filesystem mount. Both runtimes remained healthy/running and the synthetic artifact hash remained unchanged. `USE_REAL_HACIENDA=false`, `EMAIL_USE_REAL=false`, recovery disabled. Active Billing containers were not touched.

## Authorized deployment plan (not executed)

Observed active baseline (read-only, 2026-10-11):

- API: `sha256:33ab58f7742246438c74e932ca34b769dfec7831677a834e30f4677b370d8250`, created 2026-10-09, no OCI source labels, `STORAGE_TYPE=s3`, no storage bind mount.
- Worker: `sha256:7ecbdc8db304454e377d5843f7e379ef38855ac1b5ca8b71020853f6e438e243`, created 2026-10-08, only Compose labels, `STORAGE_TYPE=s3`, no storage bind mount.
- Both use the SSM secret provider and have startup recovery disabled. Real Hacienda is disabled in the API. Secret values were not read or printed.
- PostgreSQL is healthy. A read-only transaction found 22 applied migrations. The normal database contains applied `20261103000000_fix_idempotency_api_key_rotation`, while this source carries `20261110000000_make_fiscal_idempotency_rotation_safe`; this provenance difference requires explicit migration-history/checksum reconciliation before deploy.
- Delivery state contains four `DELIVERED` rows and no queued/sending/retry rows. `pgboss.job` contains no rows at the observation time.
- API/worker, PostgreSQL and LocalStack remained healthy and were not restarted or recreated.

1. Obtain recorded approvals from product/business owner, security, DBA and fiscal operator for the exact image ID, residual advisory decisions, migration list and activation window.
2. Freeze the source manifest and SBOM; promote by digest, never rebuild from the dirty working tree.
3. Confirm the target configuration uses the approved secret source, filesystem storage for both API and worker, the identical persistent mount/root/secret, mock flags disabled only when authorized, and startup/historical recovery disabled.
4. Re-run read-only artifact hash, fiscal identity, sequence, pending-delivery and migration-history preflight. Stop on any mismatch.
5. Back up PostgreSQL and durable artifact storage. Record restore evidence before any schema or runtime change.
6. Reconcile the applied `202611030...` migration with the source `202611100...` migration by exact SQL/checksum and rehearse the exact resulting migration set against a fresh restore/sanitized clone. Stop on drift or a second logical-index mutation. The operator must explicitly approve the Wave 1 idempotency migration; do not infer approval from this candidate build.
7. Stop inbound fiscal mutations, drain/verify worker claims, then deploy API and worker by the pinned digest without recreating PostgreSQL, LocalStack or durable storage.
8. Run health/readiness, storage-provider/shared-mount, lookup v1/v2, authorization, readiness and delivery recovery smoke checks with external sends disabled.
9. Activate fiscal traffic only after the operator records Hacienda/SMTP/credential readiness and the bounded recovery start timestamp. Do not enable historical replay by default.
10. Roll back application images by digest while retaining the durable filesystem and database. Do not roll back a forward-only schema blindly and do not reactivate compromised credentials.

## Deferred items

- Major framework/toolchain modernization (Nest 11+/12, Jest 30, Nest CLI 12 and associated developer dependency graph) requires a separate approved compatibility effort; it is not needed to remove runtime criticals from this candidate.
- Monitor `node-forge` for a patched release or replace its PKCS#12-only use after explicit design review.
- Production authorization and credential-owner approvals remain human decisions.
