-- Migration: add_cert_extracted_identity
-- Additive migration: adds extracted_identity_number and extracted_identity_type to fiscal_signing_certificates.
-- Both columns are nullable for backward compatibility with existing rows (F4-S bootstrap record).
-- extracted_identity_number: normalized Costa Rica fiscal identification number from OID 2.5.4.5.
-- extracted_identity_type:   derived identification type code (01=FISICA, 02=JURIDICA, 03=DIMEX, 04=NITE).

ALTER TABLE "fiscal_signing_certificates"
  ADD COLUMN "extracted_identity_number" VARCHAR(30),
  ADD COLUMN "extracted_identity_type"   VARCHAR(20);
