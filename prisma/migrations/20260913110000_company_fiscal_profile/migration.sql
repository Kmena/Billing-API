-- F2.2 -> F2.3 fiscal data remediation: cohesive issuer fiscal profile.
-- Historical FiscalDocument rows are not backfilled with fake data.

CREATE TABLE "company_fiscal_profiles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "economic_activity_code" CHAR(6) NOT NULL,
    "proveedor_sistemas" VARCHAR(20),
    "province" CHAR(1) NOT NULL,
    "canton" CHAR(2) NOT NULL,
    "district" CHAR(2) NOT NULL,
    "barrio" VARCHAR(50),
    "otras_senas" VARCHAR(250) NOT NULL,
    "email" VARCHAR(160) NOT NULL,
    "phone_country_code" VARCHAR(3),
    "phone_number" VARCHAR(20),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_fiscal_profiles_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "company_fiscal_profiles_economic_activity_code_chk" CHECK ("economic_activity_code" ~ '^[0-9]{6}$'),
    CONSTRAINT "company_fiscal_profiles_province_chk" CHECK ("province" ~ '^[0-9]$'),
    CONSTRAINT "company_fiscal_profiles_canton_chk" CHECK ("canton" ~ '^[0-9]{2}$'),
    CONSTRAINT "company_fiscal_profiles_district_chk" CHECK ("district" ~ '^[0-9]{2}$'),
    CONSTRAINT "company_fiscal_profiles_otros_senas_chk" CHECK (char_length("otras_senas") BETWEEN 5 AND 250),
    CONSTRAINT "company_fiscal_profiles_email_chk" CHECK (char_length("email") BETWEEN 3 AND 160),
    CONSTRAINT "company_fiscal_profiles_phone_pair_chk" CHECK (("phone_country_code" IS NULL AND "phone_number" IS NULL) OR ("phone_country_code" IS NOT NULL AND "phone_number" IS NOT NULL))
);

CREATE UNIQUE INDEX "company_fiscal_profiles_company_id_key" ON "company_fiscal_profiles"("company_id");
CREATE UNIQUE INDEX "company_fiscal_profiles_tenant_id_company_id_key" ON "company_fiscal_profiles"("tenant_id", "company_id");
CREATE INDEX "company_fiscal_profiles_tenant_id_idx" ON "company_fiscal_profiles"("tenant_id");

ALTER TABLE "company_fiscal_profiles" ADD CONSTRAINT "company_fiscal_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "company_fiscal_profiles" ADD CONSTRAINT "company_fiscal_profiles_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
