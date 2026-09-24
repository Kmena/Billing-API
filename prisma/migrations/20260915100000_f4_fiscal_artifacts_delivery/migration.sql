-- F4: Fiscal Artifacts, PDF & Delivery
-- Forward-only migration. No prior migration modifications.
-- Adds: FiscalArtifactType, DocumentDeliveryKind, DocumentDeliveryChannel,
--       DocumentDeliveryStatus enums; FiscalArtifact, CompanyPdfSettings,
--       DocumentDelivery, DeliveryAttempt tables; relations on Company, FiscalDocument, Tenant.

-- ─── ENUMS ─────────────────────────────────────────────────────────────────

CREATE TYPE "FiscalArtifactType" AS ENUM (
  'SIGNED_XML',
  'HACIENDA_RESPONSE_XML',
  'PDF'
);

CREATE TYPE "DocumentDeliveryKind" AS ENUM (
  'INITIAL_DOCUMENT',
  'HACIENDA_RESPONSE'
);

CREATE TYPE "DocumentDeliveryChannel" AS ENUM (
  'EMAIL'
);

CREATE TYPE "DocumentDeliveryStatus" AS ENUM (
  'PENDING',
  'QUEUED',
  'SENDING',
  'DELIVERED',
  'RETRY_PENDING',
  'FAILED',
  'MANUAL_REVIEW_REQUIRED',
  'CANCELLED'
);

-- ─── FiscalArtifact ────────────────────────────────────────────────────────
-- Metadata index for SIGNED_XML, HACIENDA_RESPONSE_XML, PDF artifacts.
-- XML types reference existing F2.3/F3 storage keys (no byte duplication).
-- PDF type has its own storage key + template/renderer version.

CREATE TABLE "fiscal_artifacts" (
  "id"                 UUID        NOT NULL,
  "tenant_id"          UUID        NOT NULL,
  "company_id"         UUID        NOT NULL,
  "fiscal_document_id" UUID        NOT NULL,
  "type"               "FiscalArtifactType" NOT NULL,
  "storage_key"        VARCHAR(700) NOT NULL,
  "sha256"             CHAR(64)    NOT NULL,
  "content_type"       VARCHAR(120) NOT NULL,
  "size_bytes"         INTEGER     NOT NULL,
  "template_id"        VARCHAR(80),
  "renderer_version"   VARCHAR(40),
  "superseded_at"      TIMESTAMP(3),
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "fiscal_artifacts_pkey" PRIMARY KEY ("id")
);

-- One active PDF artifact per document+template+rendererVersion
-- XML artifacts: template_id and renderer_version are NULL
-- The unique constraint covers both cases correctly
CREATE UNIQUE INDEX "fiscal_artifact_unique_pdf_idx"
  ON "fiscal_artifacts"("fiscal_document_id", "type", "template_id", "renderer_version");

CREATE INDEX "fiscal_artifact_scope_type_idx"
  ON "fiscal_artifacts"("tenant_id", "company_id", "fiscal_document_id", "type");

CREATE INDEX "fiscal_artifact_scope_date_idx"
  ON "fiscal_artifacts"("tenant_id", "company_id", "created_at" DESC);

ALTER TABLE "fiscal_artifacts"
  ADD CONSTRAINT "fiscal_artifacts_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "fiscal_artifacts_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "fiscal_artifacts_fiscal_document_id_fkey"
    FOREIGN KEY ("fiscal_document_id") REFERENCES "fiscal_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── CompanyPdfSettings ────────────────────────────────────────────────────
-- Controlled branding configuration. No arbitrary HTML/CSS.
-- Logo stored by reference (internal key never exposed to API clients).

CREATE TABLE "company_pdf_settings" (
  "id"                  UUID          NOT NULL,
  "tenant_id"           UUID          NOT NULL,
  "company_id"          UUID          NOT NULL,
  "template_id"         VARCHAR(80)   NOT NULL DEFAULT 'BILLING_DEFAULT_V1',
  "logo_storage_key"    VARCHAR(700),
  "logo_sha256"         CHAR(64),
  "logo_content_type"   VARCHAR(60),
  "primary_color"       VARCHAR(7),
  "secondary_color"     VARCHAR(7),
  "footer_text"         VARCHAR(500),
  "show_commercial_name" BOOLEAN      NOT NULL DEFAULT TRUE,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3) NOT NULL,

  CONSTRAINT "company_pdf_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "company_pdf_settings_company_id_key"
  ON "company_pdf_settings"("company_id");

CREATE INDEX "company_pdf_settings_scope_idx"
  ON "company_pdf_settings"("tenant_id", "company_id");

ALTER TABLE "company_pdf_settings"
  ADD CONSTRAINT "company_pdf_settings_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── DocumentDelivery ──────────────────────────────────────────────────────
-- Two delivery kinds per fiscal document: INITIAL_DOCUMENT and HACIENDA_RESPONSE.
-- Each has an independent lifecycle and attempt history.
-- DocumentDelivery.status NEVER modifies FiscalDocument.status (invariant).

CREATE TABLE "document_deliveries" (
  "id"                  UUID                     NOT NULL,
  "tenant_id"           UUID                     NOT NULL,
  "company_id"          UUID                     NOT NULL,
  "fiscal_document_id"  UUID                     NOT NULL,
  "kind"                "DocumentDeliveryKind"   NOT NULL,
  "channel"             "DocumentDeliveryChannel" NOT NULL DEFAULT 'EMAIL',
  "recipient"           VARCHAR(320)             NOT NULL,
  "package_version"     VARCHAR(80),
  "status"              "DocumentDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attempt_count"       INTEGER                  NOT NULL DEFAULT 0,
  "last_attempt_at"     TIMESTAMP(3),
  "next_attempt_at"     TIMESTAMP(3),
  "delivered_at"        TIMESTAMP(3),
  "last_error_code"     VARCHAR(120),
  "last_sanitized_error" VARCHAR(500),
  "provider_message_id" VARCHAR(255),
  "created_at"          TIMESTAMP(3)             NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3)             NOT NULL,

  CONSTRAINT "document_deliveries_pkey" PRIMARY KEY ("id")
);

-- Idempotency: one logical delivery per document+kind+channel+recipient+packageVersion
-- packageVersion NULL = default package; NULL is considered equal in the unique constraint
CREATE UNIQUE INDEX "document_delivery_unique_idx"
  ON "document_deliveries"("fiscal_document_id", "kind", "channel", "recipient", "package_version");

CREATE INDEX "document_delivery_scope_doc_idx"
  ON "document_deliveries"("tenant_id", "company_id", "fiscal_document_id");

CREATE INDEX "document_delivery_scope_status_idx"
  ON "document_deliveries"("tenant_id", "company_id", "status");

-- Index for worker due-work scan
CREATE INDEX "document_delivery_due_work_idx"
  ON "document_deliveries"("status", "next_attempt_at");

ALTER TABLE "document_deliveries"
  ADD CONSTRAINT "document_deliveries_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "document_deliveries_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "document_deliveries_fiscal_document_id_fkey"
    FOREIGN KEY ("fiscal_document_id") REFERENCES "fiscal_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── DeliveryAttempt ───────────────────────────────────────────────────────
-- Immutable history of delivery attempts. Append-only.

CREATE TABLE "delivery_attempts" (
  "id"                UUID         NOT NULL,
  "delivery_id"       UUID         NOT NULL,
  "attempt_number"    INTEGER      NOT NULL,
  "status"            VARCHAR(40)  NOT NULL,
  "provider_status"   VARCHAR(80),
  "error_code"        VARCHAR(120),
  "sanitized_error"   VARCHAR(500),
  "started_at"        TIMESTAMP(3) NOT NULL,
  "completed_at"      TIMESTAMP(3),
  "provider_message_id" VARCHAR(255),

  CONSTRAINT "delivery_attempts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "delivery_attempt_delivery_idx"
  ON "delivery_attempts"("delivery_id", "attempt_number");

ALTER TABLE "delivery_attempts"
  ADD CONSTRAINT "delivery_attempts_delivery_id_fkey"
    FOREIGN KEY ("delivery_id") REFERENCES "document_deliveries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
