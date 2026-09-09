-- Migration: 001_initial_foundation
-- Billing Fase 0: Foundation
-- Creates all tables, ENUMs and indexes for Phase 0
-- ADR-009: event_class column included from the start

-- ─── ENUMS ──────────────────────────────────────────────────────────────────

CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CANCELLED');
CREATE TYPE "TenantPlan" AS ENUM ('TRIAL', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE');
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'PENDING_VERIFICATION');
CREATE TYPE "UserRole" AS ENUM ('TENANT_ADMIN', 'MEMBER', 'READ_ONLY');
CREATE TYPE "CompanyStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "IdentificationType" AS ENUM ('FISICA', 'JURIDICA', 'DIMEX', 'NITE');
CREATE TYPE "ApiKeyStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');
CREATE TYPE "ApiKeyEnv" AS ENUM ('LIVE', 'TEST');
CREATE TYPE "EventClass" AS ENUM ('FISCAL_AUDIT', 'TECHNICAL', 'SECURITY');

-- ─── TENANTS ────────────────────────────────────────────────────────────────

CREATE TABLE "tenants" (
    "id"         UUID NOT NULL,
    "name"       VARCHAR(255) NOT NULL,
    "slug"       VARCHAR(100) NOT NULL,
    "status"     "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "plan"       "TenantPlan" NOT NULL DEFAULT 'TRIAL',
    "metadata"   JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- ─── COMPANIES ──────────────────────────────────────────────────────────────

CREATE TABLE "companies" (
    "id"                    UUID NOT NULL,
    "tenant_id"             UUID NOT NULL,
    "legal_name"            VARCHAR(255) NOT NULL,
    "trade_name"            VARCHAR(255),
    "identification_type"   "IdentificationType" NOT NULL,
    "identification_number" VARCHAR(20) NOT NULL,
    "status"                "CompanyStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at"            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at"            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "companies_tenant_id_identification_number_key"
    ON "companies"("tenant_id", "identification_number");

CREATE INDEX "companies_tenant_id_status_idx"
    ON "companies"("tenant_id", "status");

ALTER TABLE "companies"
    ADD CONSTRAINT "companies_tenant_id_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── USERS ──────────────────────────────────────────────────────────────────

CREATE TABLE "users" (
    "id"            UUID NOT NULL,
    "tenant_id"     UUID NOT NULL,
    "email"         VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "first_name"    VARCHAR(100),
    "last_name"     VARCHAR(100),
    "role"          "UserRole" NOT NULL DEFAULT 'MEMBER',
    "status"        "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_login_at" TIMESTAMPTZ,
    "created_at"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_tenant_id_email_key"
    ON "users"("tenant_id", "email");

CREATE INDEX "users_tenant_id_status_idx"
    ON "users"("tenant_id", "status");

ALTER TABLE "users"
    ADD CONSTRAINT "users_tenant_id_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── API KEYS ────────────────────────────────────────────────────────────────

CREATE TABLE "api_keys" (
    "id"          UUID NOT NULL,
    "tenant_id"   UUID NOT NULL,
    "name"        VARCHAR(255) NOT NULL,
    "environment" "ApiKeyEnv" NOT NULL DEFAULT 'LIVE',
    "key_prefix"  VARCHAR(16) NOT NULL,
    "key_hash"    VARCHAR(255) NOT NULL,
    "scopes"      TEXT[] NOT NULL DEFAULT '{}',
    "status"      "ApiKeyStatus" NOT NULL DEFAULT 'ACTIVE',
    "expires_at"  TIMESTAMPTZ,
    "last_used_at" TIMESTAMPTZ,
    "revoked_at"  TIMESTAMPTZ,
    "revoked_by"  UUID,
    "created_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "api_keys_key_prefix_key"
    ON "api_keys"("key_prefix");

CREATE INDEX "api_keys_tenant_id_status_idx"
    ON "api_keys"("tenant_id", "status");

CREATE INDEX "api_keys_key_prefix_idx"
    ON "api_keys"("key_prefix");

ALTER TABLE "api_keys"
    ADD CONSTRAINT "api_keys_tenant_id_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── API KEY ↔ COMPANY (N:M) ─────────────────────────────────────────────────

CREATE TABLE "api_key_companies" (
    "api_key_id"  UUID NOT NULL,
    "company_id"  UUID NOT NULL,

    CONSTRAINT "api_key_companies_pkey" PRIMARY KEY ("api_key_id", "company_id")
);

ALTER TABLE "api_key_companies"
    ADD CONSTRAINT "api_key_companies_api_key_id_fkey"
        FOREIGN KEY ("api_key_id") REFERENCES "api_keys"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "api_key_companies"
    ADD CONSTRAINT "api_key_companies_company_id_fkey"
        FOREIGN KEY ("company_id") REFERENCES "companies"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── REFRESH TOKENS ───────────────────────────────────────────────────────────────────────────────────────

CREATE TABLE "refresh_tokens" (
    "id"         UUID NOT NULL,
    "user_id"    UUID NOT NULL,
    "tenant_id"  UUID NOT NULL,
    "token_hash" VARCHAR(255) NOT NULL,
    "used"       BOOLEAN NOT NULL DEFAULT FALSE,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "refresh_tokens_token_hash_key"
    ON "refresh_tokens"("token_hash");

CREATE INDEX "refresh_tokens_user_id_idx"
    ON "refresh_tokens"("user_id");

CREATE INDEX "refresh_tokens_expires_at_idx"
    ON "refresh_tokens"("expires_at");

ALTER TABLE "refresh_tokens"
    ADD CONSTRAINT "refresh_tokens_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── AUDIT LOGS (append-only) ────────────────────────────────────────────────
-- No UPDATE or DELETE triggers — enforced at application layer
-- ADR-009: event_class for three-level retention classification

CREATE TABLE "audit_logs" (
    "id"             UUID NOT NULL,
    "tenant_id"      UUID,
    "company_id"     UUID,
    "api_key_id"     UUID,
    "actor"          VARCHAR(255),
    "action"         VARCHAR(255) NOT NULL,
    "resource"       VARCHAR(255),
    "endpoint"       VARCHAR(500),
    "http_method"    VARCHAR(10),
    "status_code"    INTEGER,
    "ip_address"     VARCHAR(45),
    "correlation_id" VARCHAR(36),
    "duration_ms"    INTEGER,
    "event_class"    "EventClass" NOT NULL DEFAULT 'TECHNICAL',
    "metadata"       JSONB,
    "error_message"  TEXT,
    "created_at"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_logs_tenant_id_created_at_idx"
    ON "audit_logs"("tenant_id", "created_at" DESC);

CREATE INDEX "audit_logs_correlation_id_idx"
    ON "audit_logs"("correlation_id");

CREATE INDEX "audit_logs_api_key_id_created_at_idx"
    ON "audit_logs"("api_key_id", "created_at" DESC);

CREATE INDEX "audit_logs_action_created_at_idx"
    ON "audit_logs"("action", "created_at" DESC);

CREATE INDEX "audit_logs_event_class_created_at_idx"
    ON "audit_logs"("event_class", "created_at" DESC);

ALTER TABLE "audit_logs"
    ADD CONSTRAINT "audit_logs_tenant_id_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "audit_logs"
    ADD CONSTRAINT "audit_logs_api_key_id_fkey"
        FOREIGN KEY ("api_key_id") REFERENCES "api_keys"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;
