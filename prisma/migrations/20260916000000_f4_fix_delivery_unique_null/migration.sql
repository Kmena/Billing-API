-- F4 Corrective: Fix NULL-unsafe unique index on document_deliveries.
-- 
-- Context: PostgreSQL treats NULL as distinct from every other NULL in B-tree unique indexes.
-- The original document_delivery_unique_idx on (fiscal_document_id, kind, channel, recipient, package_version)
-- does NOT prevent duplicate rows when package_version IS NULL, because NULL != NULL.
--
-- Fix: Replace with two partial indexes (the standard PostgreSQL pattern for nullable unique columns):
--   1. Rows where package_version IS NULL → uniqueness by (fiscal_document_id, kind, channel, recipient)
--   2. Rows where package_version IS NOT NULL → uniqueness by (fiscal_document_id, kind, channel, recipient, package_version)
--
-- Discovered: Real PostgreSQL concurrency test (F4 closure verification)
-- Migration: forward-only, no data loss.

DROP INDEX IF EXISTS "document_delivery_unique_idx";

-- Partial index A: uniqueness for default package (package_version IS NULL)
CREATE UNIQUE INDEX "document_delivery_unique_null_pkg_idx"
  ON "document_deliveries"("fiscal_document_id", "kind", "channel", "recipient")
  WHERE "package_version" IS NULL;

-- Partial index B: uniqueness for versioned packages (package_version IS NOT NULL)
CREATE UNIQUE INDEX "document_delivery_unique_versioned_pkg_idx"
  ON "document_deliveries"("fiscal_document_id", "kind", "channel", "recipient", "package_version")
  WHERE "package_version" IS NOT NULL;
