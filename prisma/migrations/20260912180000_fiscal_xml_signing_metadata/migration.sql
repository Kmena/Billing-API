-- F2.3 Fiscal XML/XSD/XAdES metadata
-- Forward-only migration. Preserves F2.2 document creation semantics and constraints.

ALTER TYPE "FiscalDocumentStatus" ADD VALUE IF NOT EXISTS 'XML_GENERATED';
ALTER TYPE "FiscalDocumentStatus" ADD VALUE IF NOT EXISTS 'XML_VALIDATED';
ALTER TYPE "FiscalDocumentStatus" ADD VALUE IF NOT EXISTS 'SIGNED';
ALTER TYPE "FiscalDocumentStatus" ADD VALUE IF NOT EXISTS 'READY_TO_SUBMIT';

CREATE TYPE "FiscalXmlValidationStatus" AS ENUM ('NOT_VALIDATED', 'VALID', 'INVALID');
CREATE TYPE "FiscalSigningCertificateStatus" AS ENUM ('ACTIVE', 'DISABLED', 'EXPIRED', 'REPLACED', 'INVALID');
CREATE TYPE "FiscalSigningCertificateType" AS ENUM ('HACIENDA_CRYPTOGRAPHIC_KEY', 'LEGAL_DIGITAL_SIGNATURE');

CREATE TABLE "fiscal_signing_certificates" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "environment" "HaciendaEnvironment" NOT NULL,
  "status" "FiscalSigningCertificateStatus" NOT NULL DEFAULT 'ACTIVE',
  "certificate_type" "FiscalSigningCertificateType" NOT NULL,
  "certificate_secret_reference" VARCHAR(500) NOT NULL,
  "password_secret_reference" VARCHAR(500) NOT NULL,
  "fingerprint_sha256" CHAR(64),
  "serial_number" VARCHAR(120),
  "subject_name" VARCHAR(500),
  "issuer_name" VARCHAR(500),
  "valid_from" TIMESTAMP(3),
  "valid_to" TIMESTAMP(3),
  "active_from" TIMESTAMP(3),
  "replaced_by_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "fiscal_signing_certificates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "fiscal_xml_artifacts" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "fiscal_document_id" UUID NOT NULL,
  "environment" "HaciendaEnvironment" NOT NULL,
  "document_type" "FiscalDocumentType" NOT NULL,
  "schema_version" VARCHAR(20) NOT NULL,
  "xml_profile_version" VARCHAR(40) NOT NULL,
  "unsigned_xml_storage_key" VARCHAR(700),
  "unsigned_xml_sha256" CHAR(64),
  "signed_xml_storage_key" VARCHAR(700),
  "signed_xml_sha256" CHAR(64),
  "xsd_validation_status" "FiscalXmlValidationStatus" NOT NULL DEFAULT 'NOT_VALIDATED',
  "xsd_validated_at" TIMESTAMP(3),
  "xsd_validation_errors" JSONB,
  "signing_certificate_id" UUID,
  "signature_profile" VARCHAR(60),
  "signature_algorithm" VARCHAR(120),
  "digest_algorithm" VARCHAR(120),
  "canonicalization_method" VARCHAR(120),
  "signed_at" TIMESTAMP(3),
  "signature_verified_at" TIMESTAMP(3),
  "processing_attempt_count" INTEGER NOT NULL DEFAULT 0,
  "last_error_code" VARCHAR(120),
  "last_error_message" VARCHAR(500),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "fiscal_xml_artifacts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "fiscal_signing_cert_scope_status_idx" ON "fiscal_signing_certificates"("tenant_id", "company_id", "environment", "status");
CREATE INDEX "fiscal_signing_cert_scope_type_idx" ON "fiscal_signing_certificates"("tenant_id", "company_id", "environment", "certificate_type");

CREATE UNIQUE INDEX "fiscal_xml_artifacts_tenant_id_company_id_fiscal_document_id_schema_version_xml_profile_version_key" ON "fiscal_xml_artifacts"("tenant_id", "company_id", "fiscal_document_id", "schema_version", "xml_profile_version");
CREATE INDEX "fiscal_xml_artifact_scope_type_idx" ON "fiscal_xml_artifacts"("tenant_id", "company_id", "environment", "document_type");
CREATE INDEX "fiscal_xml_artifact_validation_idx" ON "fiscal_xml_artifacts"("tenant_id", "company_id", "xsd_validation_status");

ALTER TABLE "fiscal_signing_certificates" ADD CONSTRAINT "fiscal_signing_certificates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fiscal_signing_certificates" ADD CONSTRAINT "fiscal_signing_certificates_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fiscal_signing_certificates" ADD CONSTRAINT "fiscal_signing_certificates_replaced_by_id_fkey" FOREIGN KEY ("replaced_by_id") REFERENCES "fiscal_signing_certificates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "fiscal_xml_artifacts" ADD CONSTRAINT "fiscal_xml_artifacts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fiscal_xml_artifacts" ADD CONSTRAINT "fiscal_xml_artifacts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fiscal_xml_artifacts" ADD CONSTRAINT "fiscal_xml_artifacts_fiscal_document_id_fkey" FOREIGN KEY ("fiscal_document_id") REFERENCES "fiscal_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fiscal_xml_artifacts" ADD CONSTRAINT "fiscal_xml_artifacts_signing_certificate_id_fkey" FOREIGN KEY ("signing_certificate_id") REFERENCES "fiscal_signing_certificates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
