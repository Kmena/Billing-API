-- Separate transaction: PostgreSQL must commit new enum values before they are used.
ALTER TYPE "FiscalDocumentType" ADD VALUE IF NOT EXISTS 'CREDIT_NOTE';
ALTER TYPE "FiscalDocumentType" ADD VALUE IF NOT EXISTS 'DEBIT_NOTE';
