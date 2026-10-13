# Local fiscal artifact storage

## Contract

The standard `docker-compose.yml` development stack stores fiscal artifacts on the host filesystem. It is intentionally independent of LocalStack: LocalStack remains available only for development SSM behavior.

Both `billing-api` and `billing-worker` receive the same explicit configuration and bind mount:

- `STORAGE_TYPE=local`
- `LOCAL_STORAGE_PATH=/var/lib/billing-artifacts`
- `LOCAL_STORAGE_REQUIRED_MARKER=.billing-fiscal-storage-root`
- `./storage:/var/lib/billing-artifacts`

The checked-in marker is required at the root. It prevents a container-local directory from silently replacing the intended host bind mount. Startup fails if the root, marker, or write access is unavailable. The former `docker-compose.local-storage.yml` remains only as a compatible no-op; do not rely on it for the normal path.

Production storage configuration is outside this local Compose stack and is not changed by this contract.

## Supported local commands

Before a controlled first start or rebuild, validate the effective Compose configuration and host root:

```powershell
npm run storage:preflight
```

Start the normal local stack:

```powershell
docker compose up -d
```

For an API/worker-only rebuild or recreation, preserve dependencies and their state:

```powershell
npm run storage:preflight
docker compose up -d --no-deps --build billing-api billing-worker
```

After controlled deployment, validate the actual containers as well as their effective mount/provider contract:

```powershell
npm run storage:preflight -- --runtime
```

Never use `--force-recreate` without `--no-deps` for API/worker maintenance, and never use `docker compose down -v` for this stack when fiscal evidence is present.

## Backup

Create a new, empty directory outside `storage/`; the command refuses a destination inside the active root and never overwrites a backup:

```powershell
npm run storage:backup -- --destination C:\BillingBackups\fiscal-2026-10-11
```

The command copies files without destructive synchronization, writes `fiscal-artifact-manifest.json`, and verifies every copied file by size and SHA-256. The manifest contains only logical storage keys, sizes, and hashes—never secret values.

## Isolated recovery drill

Validate a backup only into a new isolated directory. The restore command rejects an existing destination and rejects the active `storage/` root:

```powershell
npm run storage:restore -- --source C:\BillingBackups\fiscal-2026-10-11 --destination C:\BillingRecovery\isolated-2026-10-11
```

Do not restore into active storage without separate, explicit approval and a comparison of every manifest hash to the fiscal metadata. Never regenerate or substitute signed XML, Hacienda responses, or accepted PDFs.