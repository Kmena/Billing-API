-- Fix F4 XML artifact uniqueness for PostgreSQL NULL semantics.
-- The Prisma @@unique(fiscal_document_id,type,template_id,renderer_version) does not
-- prevent duplicate XML artifacts because template_id/renderer_version are NULL.
-- Enforce exactly one active XML metadata row per document/type.

CREATE UNIQUE INDEX IF NOT EXISTS "fiscal_artifact_unique_active_xml_idx"
ON "fiscal_artifacts"("fiscal_document_id", "type")
WHERE "superseded_at" IS NULL
  AND "type" IN ('SIGNED_XML', 'HACIENDA_RESPONSE_XML');
