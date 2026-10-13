-- Inventori P0 fiscal compatibility: credit invoices do not require an immediate payment method.
-- Hacienda v4.4 PlazoCredito is document-level transaction data, not issuer/company data.
ALTER TABLE "fiscal_documents"
ADD COLUMN "credit_term_days" INTEGER;

ALTER TABLE "fiscal_documents"
ALTER COLUMN "payment_method" DROP NOT NULL;
