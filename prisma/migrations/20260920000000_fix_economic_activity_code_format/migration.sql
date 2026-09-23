-- F4-S: Fix economic activity code format to accept Hacienda's native "9609.0" style.
--
-- Root cause: The original schema used CHAR(6) + '^[0-9]{6}$' check, which
-- forced users to convert Hacienda's actual format (e.g. "9609.0") into a
-- zero-padded digit-only code (e.g. "009609").  Hacienda's /fe/ae API returns
-- codes in the decimal notation "NNNN.N", which is also exactly 6 characters
-- but contains a dot.  The previous check rejected that form, causing error
-- -408 (CodigoActividadEmisor not in RUT catalog) on submission.
--
-- Fix:
--   1. Relax the check to: either 6 plain digits OR the "NNNN.N" form.
--   2. Widen column from CHAR(6) to VARCHAR(6) (semantically cleaner for
--      mixed-character codes; XSD requires exactly 6 characters as xs:string).
--
-- Data migration:
--   Existing rows that were stored as zero-padded digits (e.g. "009609")
--   MUST be updated to the correct Hacienda format before the next
--   submission attempt.  Run the companion statement below after deploying
--   this migration (adjust the WHERE clause to target only affected rows):
--
--     UPDATE company_fiscal_profiles
--        SET economic_activity_code = '9609.0'
--      WHERE economic_activity_code = '009609';
--
--   In general: query each company's actual code via
--   GET https://api.hacienda.go.cr/fe/ae?identificacion=<id_number>
--   and store the exact string returned in the "codigo" field.

ALTER TABLE "company_fiscal_profiles"
  DROP CONSTRAINT "company_fiscal_profiles_economic_activity_code_chk";

ALTER TABLE "company_fiscal_profiles"
  ALTER COLUMN "economic_activity_code" TYPE VARCHAR(6);

ALTER TABLE "company_fiscal_profiles"
  ADD CONSTRAINT "company_fiscal_profiles_economic_activity_code_chk"
    CHECK (
      "economic_activity_code" ~ '^[0-9]{6}$'
      OR "economic_activity_code" ~ '^[0-9]{4}\.[0-9]$'
    );
