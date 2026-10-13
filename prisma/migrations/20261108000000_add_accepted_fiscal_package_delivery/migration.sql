-- AFPR: distinct accepted package delivery kind; no fiscal artifact mutation.
ALTER TYPE "DocumentDeliveryKind" ADD VALUE IF NOT EXISTS 'ACCEPTED_FISCAL_PACKAGE';
