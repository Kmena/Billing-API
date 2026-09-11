CREATE TYPE "HaciendaConnectionStatus" AS ENUM ('NOT_CONFIGURED', 'PENDING_VALIDATION', 'CONNECTED', 'INVALID_CREDENTIALS', 'UNAVAILABLE', 'DISABLED');
CREATE TYPE "HaciendaEnvironment" AS ENUM ('PRODUCTION', 'SANDBOX');
CREATE TABLE "hacienda_connections" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "environment" "HaciendaEnvironment" NOT NULL,
  "status" "HaciendaConnectionStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
  "secret_reference" VARCHAR(500) NOT NULL,
  "last_validated_at" TIMESTAMPTZ,
  "last_successful_auth_at" TIMESTAMPTZ,
  "last_validation_error_code" VARCHAR(100),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "hacienda_connections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "hacienda_connections_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id"),
  CONSTRAINT "hacienda_connections_company_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id"),
  CONSTRAINT "hacienda_connections_company_env_unique" UNIQUE ("company_id", "environment")
);
CREATE INDEX "idx_hacienda_connections_tenant_id" ON "hacienda_connections"("tenant_id");
CREATE INDEX "idx_hacienda_connections_tenant_status" ON "hacienda_connections"("tenant_id", "status");