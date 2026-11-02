CREATE TABLE "fiscal_onboarding_mutations_v2" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "association_id" UUID NOT NULL,
    "environment" "HaciendaEnvironment" NOT NULL,
    "operation" VARCHAR(40) NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "request_digest" CHAR(64) NOT NULL,
    "state" VARCHAR(40) NOT NULL,
    "new_secret_references" JSONB NOT NULL,
    "retired_secret_references" JSONB NOT NULL,
    "response" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "fiscal_onboarding_mutations_v2_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fiscal_onboarding_mutation_v2_state_check" CHECK ("state" IN ('STAGED', 'COMMITTED', 'COMMITTED_CLEANUP_PENDING', 'COMPENSATED', 'RECOVERY_REQUIRED')),
    CONSTRAINT "fiscal_onboarding_mutation_v2_operation_check" CHECK ("operation" IN ('CERTIFICATE_UPLOAD', 'CREDENTIALS_CONFIGURE', 'CREDENTIALS_ROTATE'))
);

CREATE UNIQUE INDEX "fiscal_onboarding_mutation_v2_idempotency_key" ON "fiscal_onboarding_mutations_v2"("association_id", "operation", "idempotency_key");
CREATE INDEX "fiscal_onboarding_mutation_v2_recovery_idx" ON "fiscal_onboarding_mutations_v2"("state", "updated_at");
CREATE INDEX "fiscal_onboarding_mutation_v2_scope_idx" ON "fiscal_onboarding_mutations_v2"("tenant_id", "company_id", "environment");
ALTER TABLE "fiscal_onboarding_mutations_v2" ADD CONSTRAINT "fiscal_onboarding_mutation_v2_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fiscal_onboarding_mutations_v2" ADD CONSTRAINT "fiscal_onboarding_mutation_v2_company_fkey" FOREIGN KEY ("company_id", "tenant_id") REFERENCES "companies"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fiscal_onboarding_mutations_v2" ADD CONSTRAINT "fiscal_onboarding_mutation_v2_association_fkey" FOREIGN KEY ("association_id", "tenant_id", "environment") REFERENCES "fiscal_consumer_associations"("id", "tenant_id", "environment") ON DELETE RESTRICT ON UPDATE CASCADE;
