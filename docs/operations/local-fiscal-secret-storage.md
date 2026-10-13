# Local fiscal secret storage

Status: active in the authorized local environment; production remains unauthorized. This runbook never authorizes a production rollout by itself.

## Incident conclusion (2026-10-13)

The active local Billing configuration stored fiscal material in LocalStack Community 3.x SSM. That service keeps SSM state in memory; the configured `PERSISTENCE=1` is a Pro-only capability. The active LocalStack instance began on 2026-10-11, after the last successful Hacienda authentication on 2026-10-03. Its logs show the fiscal references resolving as `ParameterNotFound`. PostgreSQL retained reference metadata, but the referenced values were not present. This is a provider-durability failure, not evidence of a wrong reference or tenant binding.

Non-disclosing affected inventory:

- Hacienda SANDBOX connection: one reference, fingerprint `0113ea6a06d9b6e3b32c34e0f12e7d9259dc1affb47fbbc2f10736b90f3073b6`.
- Active signing certificate: one reference, fingerprint `fb43a95b3dbea1532f1f8e54496fcf1da8a7ede9241926c5515dade33b46b660`.
- Certificate PIN: one reference, fingerprint `4d7b97dbe3784568c8c955a1f97e8234e23accef555f5263f73216e35e0fc418`.
- All three provider resolutions were missing at assessment time.
- No secret value was printed, logged, copied into this document, or committed.

The originals are recoverable from existing gitignored operator material: the sandbox username/password and PIN are present in `.env.local`; the PKCS#12 file is present under `.secrets`; its SHA-256 is `38016cc5bf2029885a61257617e13bee1c81183b3f8ddafa5f9f1320f0e18e95`, exactly matching the active Billing certificate metadata. A new Hacienda account, certificate or PIN is not required. This conclusion does not imply that a migration has been executed.

## Provider contract

`SECRET_PROVIDER=local-encrypted` selects `EncryptedFileSecretProvider` explicitly; there is no runtime fallback to environment variables, SSM or LocalStack.

- AES-256-GCM encrypts every immutable version with a fresh 96-bit IV.
- Reference/version metadata is authenticated as additional data.
- Only SHA-256 reference fingerprints appear in paths and metadata.
- Writes use exclusive temporary files, `fsync`, atomic publication and a per-reference cross-process lock.
- Deletes create encrypted tombstone versions; previous encrypted versions remain available for audit/rollback procedures.
- The store marker carries a random store identity and encrypted key check.
- Startup fails closed if the root, marker or key is missing; the key is wrong; permissions are unsafe on POSIX; the store is read-only; metadata is inconsistent; a record is missing/corrupt; or any record cannot decrypt.
- API and worker receive the same store and read-only key mounts in `docker-compose.yml`. Neither depends on LocalStack for secrets.
- Fiscal readiness continues resolving the connection credential, PKCS#12 and PIN through `SecretProvider`; metadata alone cannot produce ready state.

The encrypted data root is `./secrets-storage` on the local host and `/var/lib/billing-secrets` in the containers. The master key is a distinct operator-managed file such as `./.secrets/billing-local-secret-store.key`, mounted read-only at `/run/secrets/billing-local-secret-store.key`. Never place the key below the encrypted data root, in an image, source control, a backup of the encrypted store, or an environment variable.

## Initial preparation (authorized maintenance window only)

These commands are preparation instructions. They were not run against the active environment during this remediation.

1. Capture the current image identifiers, `docker compose config`, read-only database reference inventory, and encrypted-artifact backup. Confirm the active company, tenant, environment and certificate fingerprint.
2. Restrict the operator key directory to the operator and the container runtime account. On POSIX, use directory mode `0700` and key mode `0400` or `0600`; grant the container UID 1001 read access without granting group/other access. Windows ACLs must grant only the operator and the Docker runtime identity.
3. Initialize only a new, empty store. The command uses exclusive creation and refuses an existing store or key:

   ```powershell
   npm run secrets:init -- --confirm-new-store --store .\secrets-storage --master-key .\.secrets\billing-local-secret-store.key
   ```

4. Put the existing JWT signing secret into the provider without printing it. The command creates a missing reference, accepts an identical existing value, and refuses a conflict:

   ```powershell
   npm run secrets:put -- --confirm-create-or-identical --store .\secrets-storage --master-key .\.secrets\billing-local-secret-store.key --reference JWT_SECRET --value-env JWT_SECRET
   ```

5. In a secured operator shell, load the already-existing `F4S_SANDBOX_USERNAME`, `F4S_SANDBOX_PASSWORD`, and `F4S_SANDBOX_CERT_PIN` values. Run the create-or-identical migration with the exact three references from the read-only inventory and the approved certificate fingerprint:

   ```powershell
   npm run secrets:migrate-hacienda -- --confirm-recovered-values --store .\secrets-storage --master-key .\.secrets\billing-local-secret-store.key --certificate-file .\.secrets\hacienda-sandbox.p12 --certificate-sha256 38016cc5bf2029885a61257617e13bee1c81183b3f8ddafa5f9f1320f0e18e95 --credentials-ref <EXACT_CONNECTION_REFERENCE> --certificate-ref <EXACT_CERTIFICATE_REFERENCE> --pin-ref <EXACT_PIN_REFERENCE>
   ```

6. Verify full decryption without outputting values:

   ```powershell
   npm run secrets:verify -- --store .\secrets-storage --master-key .\.secrets\billing-local-secret-store.key
   ```

7. Configure the gitignored Compose environment with `LOCAL_STORAGE_SECRET` and:

   ```text
   LOCAL_SECRET_STORE_MASTER_KEY_FILE=./.secrets/billing-local-secret-store.key
   ```

8. Validate before changing services:

   ```powershell
   docker compose config --quiet
   docker compose build billing-api billing-worker
   ```

9. During an explicitly approved window, stop only Billing API/worker, retain PostgreSQL and artifact storage, then recreate only those two services from the verified candidate. Do not recreate LocalStack as part of this change because it is no longer a secret dependency:

   ```powershell
   docker compose up -d --no-deps --force-recreate billing-api billing-worker
   ```

10. Require API health, worker liveness, startup preflight success, provider identity `local-encrypted-v1`, and canonical fiscal readiness for the approved company/environment before resuming issuance. Never print resolved values while validating.

## Backup and restore

Create backups only to a new, separate destination. Backups include the marker, encrypted version records, metadata and a SHA-256 manifest; they exclude locks, temporary files, the master key and certificate files.

```powershell
npm run secrets:backup -- --source .\secrets-storage --destination <NEW_ENCRYPTED_BACKUP_DIRECTORY>
```

Store the master key in a different access-controlled backup system. Losing either half makes recovery impossible. Restore always targets a new empty path and requires the separately recovered key:

```powershell
npm run secrets:restore -- --confirm-new-destination --backup <ENCRYPTED_BACKUP_DIRECTORY> --destination <NEW_RESTORE_DIRECTORY> --master-key <SEPARATELY_RECOVERED_KEY_FILE>
npm run secrets:verify -- --store <NEW_RESTORE_DIRECTORY> --master-key <SEPARATELY_RECOVERED_KEY_FILE>
```

A manifest mismatch, missing/unexpected file, wrong key, authentication-tag failure or invalid marker blocks restore. Never overwrite the active store in place. Validate the restored copy first, then change mounts in a controlled maintenance window.

## Master-key rotation

Rotation is a migration, not an in-place rewrite:

1. Obtain explicit authorization and a maintenance window.
2. Inventory every active reference from configuration and read-only database metadata.
3. Initialize a new store with a new key at new paths. Never replace the active key file.
4. Copy each value through `SecretProvider` in an offline, non-logging process, or re-run the create-or-identical recovery commands from approved sources. Verify reference counts and full decryption.
5. Back up the new encrypted store and its key separately.
6. Switch API and worker mounts together; validate health and fiscal readiness; retain the old encrypted store/key under restricted rollback retention.
7. Destroy old key material only after the retention decision is separately approved and recorded.

## Failure recovery and rollback

- Missing/wrong key or corrupt data: do not initialize, overwrite or delete anything. Stop the candidate, preserve evidence, and restore the last verified encrypted backup plus its matching separate key into a new path.
- Partial Hacienda migration: rerun the same command. Identical references are accepted; conflicting references fail before new writes.
- Candidate startup failure: keep issuance disabled, revert API and worker together to the prior verified configuration only if that configuration has a resolvable durable secret source. The known LocalStack SSM state is not a valid functional rollback source.
- Readiness failure after startup: do not bypass readiness or substitute environment secrets. Compare only non-disclosing reference fingerprints, provider identity, store identity, and certificate fingerprint.
- Key loss with no recoverable backup: encrypted values cannot be recovered. Use the documented secure re-enrollment path; do not mutate historical documents, fiscal identities, reservations or official consecutives.

## Secure re-enrollment fallback

If an original value is genuinely unrecoverable, use the existing authenticated, tenant/company/environment-bound administrative flows to re-enter Hacienda credentials and upload a certificate/PIN. Validate certificate identity and dates before activation. Preserve prior connection/certificate history and audit evidence, never expose material to browsers or logs, and never alter historical fiscal artifacts. Re-enrollment requires separate operator authorization; it is not part of this remediation execution.

## Controlled local activation preflight (2026-10-13)

The authorized local activation stopped before key generation, backup creation, secret migration, image build or service recreation because the source/deployment gate failed closed.

Verified non-disclosing evidence:

- `.env.local` still contains all three required recovery variables; the retained PKCS#12 opens with the retained PIN, contains a private key, matches the Billing company identity and has SHA-256 `38016cc5bf2029885a61257617e13bee1c81183b3f8ddafa5f9f1320f0e18e95`.
- PostgreSQL remains `billing_dev` with 22 completed and zero unfinished recorded migrations, two fiscal documents, five idempotency reservations, one sequence, six artifact rows, seven certificate rows with one active certificate, and one connected SANDBOX Hacienda row. The tenant/company/environment binding and all three reference fingerprints match the approved inventory.
- Four delivery rows are `DELIVERED`; no other delivery state and no active pg-boss job exists. Latest document, submission-attempt and delivery-attempt timestamps remain 2026-10-08, 2026-10-08 and 2026-10-09 respectively.
- Fourteen metadata references resolve to eight distinct filesystem objects. Every object exists below the marked storage root, all eight SHA-256 values match PostgreSQL, no reference lacks a hash and no key has conflicting hashes.
- Active API and worker remain healthy on their unchanged images, use `SECRET_PROVIDER=ssm`, and have no durable secret-store mount. PostgreSQL and LocalStack were not recreated.
- No local encrypted store, master-key file or encrypted-store backup currently exists. The original ignored recovery sources remain untouched.

Blocking deployment evidence:

- The source checkout is not a provenance-isolated secret-storage candidate; it contains the accumulated uncommitted fiscal implementation set.
- The normal database has 22 applied migrations, while the checkout contains three unapplied migrations: `20261110000000_make_fiscal_idempotency_rotation_safe`, `20261112000000_add_fiscal_onboarding_v1` and `20261113000000_allow_inventori_bootstrap_profile`.
- Applied migration `20261103000000_fix_idempotency_api_key_rotation` is absent from the checkout. Its previously documented provenance gap remains unresolved.
- This activation does not authorize normal migrations or deployment of unrelated changes. Rebuilding API/worker from the current checkout would therefore violate the activation boundary.
- Separate recoverable custody for a newly generated master key and a fresh backup destination have not yet been designated. A key must not be generated until those operator-owned destinations are approved.

To resume, first produce and verify a provenance-bound candidate containing only the approved runtime baseline plus the durable-secret changes, reconcile the applied/pending migration gate under separate authorization, and designate separate restricted custody for the master key and backups. Then repeat the entire preflight; do not reuse a partial result.

## Final local recovery preparation (2026-10-13)

Preparation advanced to the explicit active-operation boundary without changing either normal database or replacing any active service.

- Fresh custom-format backups were created and restored successfully: billing_dev.backup (SHA-256 cfef0496cde6b6aeb185dd02f3f94651bd3c67c1841914f72a6b62eb49744e80) and tracksys.backup (SHA-256 d6dda3d11e5fd02fe7cb5438c0d54dbe20dd23e3d5689b3c4947e39c7c2cabd9). The 536-file artifact backup also restored successfully; all fourteen metadata references still resolve to eight hash-matching historical objects.
- A 352-file Billing allowlist manifest hashes to f656411a52e2213ef90970dbbce0082311a60711f3d6d0207344a03a625e7100. Its reproducibly rebuilt candidate image is sha256:a4a02cbc69eb192187145286cdb008827b0006f7e77b66f2ae258087414f187e. Secret-value scanning found no recovered value, private-key marker or forbidden secret file in the candidate.
- The exact three pending Billing migrations applied successfully to the restored database. Fiscal-document, idempotency-reservation and sequence fingerprints remained unchanged; no logical duplicate or cross-tenant document conflict appeared. The historical applied migration whose SQL artifact is absent remains a documented provenance limitation. No migration record was fabricated or resolved.
- The original three recovery sources remain available without disclosure. The PKCS#12 remains 6,868 bytes and hashes to 38016cc5bf2029885a61257617e13bee1c81183b3f8ddafa5f9f1320f0e18e95. No active master key or encrypted store exists.
- Billing disposable E2E passed 153/153; encrypted-provider and corrupt-artifact focused tests passed 13/13. Prisma validation and typecheck pass; lint exits zero with the existing 22 warnings.

Read-only cryptographic verification of Inventori association 1684 found that its current environment-backed API key is authentic, active, unexpired, TEST/SANDBOX-compatible and bound to the approved tenant and Billing company. The legal identity and active certificate binding match. It is nevertheless a legacy key: the normal database does not yet contain api_keys.integration_profile, and the key lacks eighteen capabilities in the approved inventori-fiscal-v1 catalog.

Therefore the active plan must not broaden or relabel the legacy key by SQL. After the Billing migration is authorized and applied, Billing must issue a new company/environment-bound inventori-fiscal-v1 credential through the existing privileged bootstrap/returned-once handoff. Inventori must encrypt it immediately in its server-only managed credential store, persist only the opaque reference, verify canonical read-back, and revoke the prior operational key only after the replacement passes readiness. This key transition is a distinct authorized mutation and is not implied by secret-provider activation.

The remaining local activation order is:

1. Approve the exact normal-database migration and association plan, maintenance window, candidate images, key-custody locations and recovery procedure as one consolidated operation.
2. Enter a bounded maintenance window by stopping only Inventori PID 25068 and Billing API/worker after rechecking identities and empty queues. Preserve PostgreSQL, Redis, LocalStack and fiscal artifacts.
3. Apply only the three verified pending Billing migrations; retain the historical missing-file migration record/checksum and do not use migrate resolve.
4. Initialize a new local-encrypted-v1 store with a new operator key at the approved primary path; create a separately ACL-restricted recovery copy outside Git and outside the encrypted store. Independently establish the Inventori managed-credential encryption key/directory and recovery custody.
5. Migrate the exact existing Hacienda credential, certificate and PIN references with create-or-identical semantics; deep-verify and back up encrypted data without the key.
6. Recreate only Billing API/worker from the recorded candidate with recovery held disabled. Require provider identity, health, shared mounts and zero external activity.
7. Through existing Billing TENANT_ADMIN authority, create a tenant-bound inventori-bootstrap-v1 identity and invoke the candidate bootstrap endpoint. One server-side operator process captures both returned-once values into Inventori encrypted storage, verifies tenant/company/environment/profile binding before any association-row change, and never exposes either value to console, browser or plaintext files.
8. Disable association 1686 with exact predicates, apply the verified Inventori migration, and CAS-update association 1684 from its legacy environment reference to the verified managed reference. Confirm only 1686 becomes HISTORICAL_ONLY and repeated execution changes zero rows.
9. Start the approved Inventori candidate/config against preserved PostgreSQL and Redis.
10. Require Billing/Inventori health, canonical readiness, historical-object hashes, zero sequence allocation, zero unexpected delivery, and no external Hacienda/SMTP traffic before considering local activation complete. Revoke the legacy M2M key only after the replacement path passes.

The operation remains blocked until one consolidated operator authorization names the separate master-key custody destination. This preparation does not authorize production or any real Hacienda/SMTP/AFPR action.

## Controlled local activation result (2026-10-13)

The consolidated local maintenance authorization was received and the prepared procedure completed. Pre-mutation gates passed for TENANT_ADMIN authority, fresh database/artifact backup restoration, candidate image identity and separate recoverable custody for the Billing and Inventori keys.

The original Hacienda credential, original PKCS#12 and original PIN were migrated with create-or-identical semantics after the certificate SHA-256 matched metadata. `JWT_SECRET` was migrated separately. Deep verification reports four active encrypted values. The encrypted-only nine-file backup excludes the key, has manifest SHA-256 `06f4f82f38596e2bba460f091a4f5ec3b1c782c702e33784390d1e1d2131764e`, restored into a new directory and decrypted successfully.

Docker Desktop initially exposed the Windows bind-mounted key/store with broad POSIX permission bits. `local-encrypted-v1` correctly failed closed before API listen. The active local configuration therefore uses two separate Docker Linux volumes: `billing_local_encrypted_secrets` for encrypted data and `billing_local_secret_key` for the read-only runtime key. Data directories are owned by UID/GID 1001 with mode 0700; files use 0600. The primary host key and its ACL-restricted recovery copy remain outside the encrypted store, so runtime Linux permissions do not replace operator custody.

Billing API and worker run candidate image `sha256:a4a02cbc69eb192187145286cdb008827b0006f7e77b66f2ae258087414f187e`, report healthy, share the same encrypted-data/artifact mounts and key volume, and keep startup recovery disabled. An in-container full-store verification and a controlled API/worker restart both passed. LocalStack remains running for unrelated local compatibility but is not a secret dependency.

Canonical Billing and Inventori readiness both return `readyToIssue=true` with no blockers. The active certificate fingerprint is unchanged. No active pg-boss job or non-delivered row exists, and no submission/delivery timestamp advanced. No Hacienda request, SMTP send or AFPR execution occurred.

For future recovery, restore the encrypted backup into a new Linux volume or private POSIX path, recover the matching key from the separate custody root, enforce 0700/0600 ownership for UID/GID 1001, run the deep verifier, and switch API/worker together. Never copy the key into the encrypted-data backup or relax the provider permission check for a Windows bind mount.
