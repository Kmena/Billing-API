-- TASK-004: Align CompanyFiscalProfile address code constraints with Hacienda v4.4 UbicacionType.
-- Provincia is a positive integer with one digit; Canton/Distrito are positive integers with two digits.
-- Barrio remains optional per v4.4 XSD; OtrasSenas remains required 5..250 chars.

ALTER TABLE "company_fiscal_profiles"
  DROP CONSTRAINT IF EXISTS "company_fiscal_profiles_province_chk",
  DROP CONSTRAINT IF EXISTS "company_fiscal_profiles_canton_chk",
  DROP CONSTRAINT IF EXISTS "company_fiscal_profiles_district_chk";

ALTER TABLE "company_fiscal_profiles"
  ADD CONSTRAINT "company_fiscal_profiles_province_positive_chk" CHECK ("province" ~ '^[1-9]$'),
  ADD CONSTRAINT "company_fiscal_profiles_canton_positive_chk" CHECK ("canton" ~ '^(0[1-9]|[1-9][0-9])$'),
  ADD CONSTRAINT "company_fiscal_profiles_district_positive_chk" CHECK ("district" ~ '^(0[1-9]|[1-9][0-9])$');
