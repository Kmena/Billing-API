-- Canonical forward recovery for the lost SUPERSEDED lifecycle migration.
-- Safe for clean databases and for databases that already have the equivalent schema.
-- Does not recreate 20261005000000_add_fiscal_superseded_lifecycle.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'FiscalDocumentStatus' AND e.enumlabel = 'SUPERSEDED'
  ) THEN
    ALTER TYPE "FiscalDocumentStatus" ADD VALUE 'SUPERSEDED';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'FiscalSubmissionStatus' AND e.enumlabel = 'SUPERSEDED'
  ) THEN
    ALTER TYPE "FiscalSubmissionStatus" ADD VALUE 'SUPERSEDED';
  END IF;
END $$;

ALTER TABLE "fiscal_documents"
  ADD COLUMN IF NOT EXISTS "disposed_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "disposed_by" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "disposition_reason" VARCHAR(500),
  ADD COLUMN IF NOT EXISTS "superseded_by_fiscal_document_id" UUID;

DO $$
DECLARE
  existing_fk text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'fiscal_documents'
      AND column_name = 'disposed_at'
      AND (data_type <> 'timestamp without time zone' OR is_nullable <> 'YES')
  ) THEN RAISE EXCEPTION 'incompatible fiscal_documents.disposed_at'; END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'fiscal_documents'
      AND column_name = 'disposed_by'
      AND (data_type <> 'character varying' OR character_maximum_length <> 255 OR is_nullable <> 'YES')
  ) THEN RAISE EXCEPTION 'incompatible fiscal_documents.disposed_by'; END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'fiscal_documents'
      AND column_name = 'disposition_reason'
      AND (data_type <> 'character varying' OR character_maximum_length <> 500 OR is_nullable <> 'YES')
  ) THEN RAISE EXCEPTION 'incompatible fiscal_documents.disposition_reason'; END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'fiscal_documents'
      AND column_name = 'superseded_by_fiscal_document_id'
      AND (data_type <> 'uuid' OR is_nullable <> 'YES')
  ) THEN RAISE EXCEPTION 'incompatible fiscal_documents.superseded_by_fiscal_document_id'; END IF;

  SELECT pg_get_constraintdef(oid) INTO existing_fk
  FROM pg_constraint
  WHERE conrelid = 'public.fiscal_documents'::regclass
    AND conname = 'fiscal_documents_superseded_by_fkey';

  IF existing_fk IS NULL THEN
    ALTER TABLE "fiscal_documents"
      ADD CONSTRAINT "fiscal_documents_superseded_by_fkey"
      FOREIGN KEY ("superseded_by_fiscal_document_id")
      REFERENCES "fiscal_documents"("id") ON UPDATE CASCADE ON DELETE SET NULL;
  ELSIF existing_fk <> 'FOREIGN KEY (superseded_by_fiscal_document_id) REFERENCES fiscal_documents(id) ON UPDATE CASCADE ON DELETE SET NULL' THEN
    RAISE EXCEPTION 'incompatible fiscal_documents_superseded_by_fkey: %', existing_fk;
  END IF;
END $$;

DO $$
DECLARE
  existing_indexdef text;
BEGIN
  SELECT indexdef
    INTO existing_indexdef
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename = 'fiscal_documents'
    AND indexname = 'fiscal_documents_superseded_by_idx';

  IF existing_indexdef IS NULL THEN
    CREATE INDEX "fiscal_documents_superseded_by_idx"
      ON "fiscal_documents"("superseded_by_fiscal_document_id");
  ELSIF existing_indexdef <> 'CREATE INDEX fiscal_documents_superseded_by_idx ON public.fiscal_documents USING btree (superseded_by_fiscal_document_id)' THEN
    RAISE EXCEPTION 'incompatible fiscal_documents_superseded_by_idx: %', existing_indexdef;
  END IF;
END $$;
