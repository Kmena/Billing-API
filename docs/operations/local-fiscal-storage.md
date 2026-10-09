# Local fiscal artifact storage

## Purpose

The default development stack uses LocalStack S3 and is suitable for S3 integration work, but LocalStack Community state must not be treated as a durable fiscal-artifact archive. For durable local recovery work, opt in to the local filesystem adapter with the compose override:

```powershell
docker compose -f docker-compose.yml -f docker-compose.local-storage.yml up -d billing-api billing-worker
```

Both processes mount the same repository `storage/` root at `/var/lib/billing-artifacts`; logical Billing storage keys remain unchanged. This override is local-only and must never be used for production deployment.

## Backup procedure

1. Stop fiscal processing before taking the copy.
2. Create a dated, read-only copy of `storage/` outside the repository using the approved local backup mechanism.
3. Record a SHA-256 manifest for the copied files.
4. Preserve the manifest with the backup and validate it before any controlled artifact reimport.

Never use test cleanup or `docker compose down -v` against fiscal artifact storage. Historical artifacts must only be reimported through a separately authorized, hash-verified procedure.
