-- Allow an issuer to save its fiscal address and contact before verified
-- economic activities are available. Existing values are preserved.
ALTER TABLE "company_fiscal_profiles" ALTER COLUMN "economic_activity_code" DROP NOT NULL;
