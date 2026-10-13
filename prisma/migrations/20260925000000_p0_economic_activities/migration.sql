-- P0: Hacienda taxpayer and economic activity validation
-- Migration: 20260925000000_p0_economic_activities
--
-- Changes:
--   1. Company: add hacienda_tax_situation, hacienda_moroso, hacienda_omiso
--   2. CompanyFiscalProfile: widen economic_activity_code VARCHAR(6) → VARCHAR(20);
--                            add default_economic_activity_id FK
--   3. New table: company_economic_activities
--
-- Backward-compatible: all new columns are nullable; existing rows are unaffected.
-- DEC-006: legacy economicActivityCode is preserved; new column is NOT the source of truth.

-- ─── 1. Company: taxpayer verification detail fields ─────────────────────────

ALTER TABLE "companies"
ADD COLUMN "hacienda_tax_situation" VARCHAR(50),
ADD COLUMN "hacienda_moroso"        BOOLEAN,
ADD COLUMN "hacienda_omiso"         BOOLEAN;

-- ─── 2. CompanyFiscalProfile: widen legacy code + add default FK ─────────────

-- Widen VARCHAR(6) → VARCHAR(20) to accommodate both legacy "960900" and
-- Hacienda /fe/ae format "9609.0" or future codes without DB constraint change.
ALTER TABLE "company_fiscal_profiles"
ALTER COLUMN "economic_activity_code" TYPE VARCHAR(20);

ALTER TABLE "company_fiscal_profiles"
ADD COLUMN "default_economic_activity_id" UUID;

-- ─── 3. New table: company_economic_activities ───────────────────────────────

CREATE TABLE "company_economic_activities" (
    "id"                  UUID         NOT NULL,
    "tenant_id"           UUID         NOT NULL,
    "company_id"          UUID         NOT NULL,
    "code"                VARCHAR(20)  NOT NULL,
    "description"         VARCHAR(255) NOT NULL,
    "hacienda_status"     VARCHAR(10)  NOT NULL,
    "hacienda_kind"       VARCHAR(10),
    "billing_enabled"     BOOLEAN      NOT NULL DEFAULT true,
    "verified_at"         TIMESTAMP(3) NOT NULL,
    "last_seen_at"        TIMESTAMP(3) NOT NULL,
    "verification_source" VARCHAR(50)  NOT NULL,
    "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"          TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_economic_activities_pkey" PRIMARY KEY ("id")
);

-- FK constraints
ALTER TABLE "company_economic_activities"
ADD CONSTRAINT "company_economic_activities_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "company_economic_activities"
ADD CONSTRAINT "company_economic_activities_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Add FK on company_fiscal_profiles.default_economic_activity_id
ALTER TABLE "company_fiscal_profiles"
ADD CONSTRAINT "company_fiscal_profiles_default_economic_activity_id_fkey"
    FOREIGN KEY ("default_economic_activity_id")
    REFERENCES "company_economic_activities"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Unique constraint: one activity record per (company, code)
CREATE UNIQUE INDEX "company_economic_activities_company_id_code_key"
    ON "company_economic_activities"("company_id", "code");

-- Lookup index
CREATE INDEX "company_economic_activities_tenant_company_idx"
    ON "company_economic_activities"("tenant_id", "company_id");

-- Index for the FK on fiscal_profile → default activity
CREATE INDEX "company_fiscal_profile_default_activity_idx"
    ON "company_fiscal_profiles"("default_economic_activity_id");
