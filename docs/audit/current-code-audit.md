# Executive Summary

Final post-implementation baseline audit for confirmed canonical spec `specs/post-f2-2-remediation/`.

Post-F2.2 remediation is complete from the inspected repository state. The canonical ownership documentation now consistently identifies `specs/post-f2-2-remediation/` as the active owner, while Post-F2.2 records under `specs/fase-1-hacienda-consultas/` are clearly labeled historical/misclassified records only.

No blocking Post-F2.2-specific regression was found in the inspected files. The final Prisma schema and forward migration match the intended fiscal constraints:

- fiscal consecutive uniqueness is scoped by `(tenantId, companyId, environment, consecutive)`;
- `clave` remains globally unique;
- canonical fiscal idempotency uniqueness is enforced by `FiscalIdempotencyKey` on `(tenantId, companyId, apiKeyId, operation, key)`;
- the legacy `FiscalDocument` unique idempotency constraint on `(tenantId, companyId, idempotencyKey)` is removed and replaced by a non-unique support index.

Validation commands were not re-executed by this audit agent. The audit accepts the supplied/reconciled evidence as recorded in the canonical spec and root docs: `npm ci`, Prisma generate/validate, clean `billing_e2e` reset, `prisma migrate deploy`, lint/lint:check, typecheck, unit tests, build, full E2E, fiscal E2E and PostgreSQL concurrency coverage all passed. `npm audit` still reports 26 pre-existing vulnerabilities.

# Overall Score

Overall Score: 9.0/10.

Justification:

- Strong alignment between schema, migration, canonical docs and fiscal E2E/concurrency test intent.
- No blocking Post-F2.2-specific implementation gap found.
- Documentation separation is now clear: current-state truth, active architecture, action planning and future architecture are distinguishable.
- Fiscal tests cover the previously risky behavior: idempotency, scoped consecutive uniqueness, sanitized responses and PostgreSQL concurrency.
- Score is not higher because repository-level risks remain: `FiscalDocumentService` is large and tightly coupled to Prisma, fiscal response contracts are still not formalized as explicit response DTOs, fiscal lines are JSON snapshots, Docker Compose contains local/default-secret risks if reused as production, and `npm audit` reports pre-existing vulnerabilities.

Final classification: Acceptable.

# Repository Overview

The repository is a NestJS/TypeScript modular monolith using Prisma and PostgreSQL. It contains implemented Foundation, Fase 1 Hacienda public lookup modules, F2.1 Hacienda connection, F2.2 Fiscal Document Core and completed Post-F2.2 fiscal remediation.

Relevant inspected areas:

- `specs/post-f2-2-remediation/*`
- `specs/fase-1-hacienda-consultas/*`
- `docs/current-state.md`
- `docs/architecture.md`
- `docs/action-plan.md`
- `docs/tasks.md`
- `docs/changelog.md`
- `docs/future-architecture.md`
- `prisma/schema.prisma`
- `prisma/migrations/20260911140000_fiscal_document_core/migration.sql`
- `prisma/migrations/20260911143000_fiscal_idempotency_scope/migration.sql`
- `prisma/migrations/20260912123000_post_f2_2_fiscal_constraints/migration.sql`
- `src/modules/fiscal-documents/application/fiscal-document.service.ts`
- `src/modules/fiscal-documents/infrastructure/http/*`
- `test/e2e/fase2/fiscal-documents.e2e-spec.ts`
- `test/e2e/fase2/fiscal-management.e2e-spec.ts`
- `test/e2e/fase2/fiscal-concurrency.e2e-spec.ts`
- `Dockerfile`, `docker-compose.yml`, `.github/workflows/ci.yml`, `package.json`

# Current Architecture

Current architectural style: API-first modular monolith with incremental layered/hexagonal conventions.

Observed fiscal dependency direction:

```text
HTTP controllers -> FiscalDocumentService -> PrismaService / AuditService
FiscalDocumentService -> fiscal domain helpers
```

Persistence strategy: Prisma ORM with PostgreSQL migrations. Fiscal sequence allocation and idempotency reservation use raw PostgreSQL SQL inside Prisma transactions.

Authentication and authorization:

- Fiscal create/read endpoints use API-key authentication.
- Create endpoints use type-specific static scopes: `invoices:write`, `tickets:write`.
- Read endpoint determines the required read scope dynamically from persisted document type: `invoices:read` or `tickets:read`.
- Management endpoints use JWT and a service-local `TENANT_ADMIN` role check.
- API-key/company authorization is checked through `apiKeyCompany`.

Event processing: fiscal audit events are recorded through `AuditService`. No F2.3 XML/submission workers are implemented.

Deployment: Dockerfile is multi-stage and runtime uses a non-root user. Docker Compose is local/development-oriented and includes default credentials/secrets.

# Documentation Findings

## AUD-001

- Severity: Suggestion
- Category: Documentation / Canonical Ownership
- Location: `specs/post-f2-2-remediation/current-state.md`, `docs/current-state.md`, `docs/architecture.md`, `specs/fase-1-hacienda-consultas/*`
- Evidence: Canonical spec is explicitly stated as `specs/post-f2-2-remediation/`. Root docs state Post-F2.2 remediation is complete under that path. Fase 1 files label appended Post-F2.2 sections as historical misclassified records and direct readers to `specs/post-f2-2-remediation/`.
- Impact: The prior ownership ambiguity is resolved. Downstream agents can distinguish Fase 1 historical records from canonical Post-F2.2 state.
- Recommendation: Preserve this separation. Do not move active Post-F2.2 status back under `specs/fase-1-hacienda-consultas/`.

Documentation separation assessment:

- Current-state truth: Correctly separated in `docs/current-state.md` and `specs/post-f2-2-remediation/current-state.md`.
- Active architecture: Correctly separated in `docs/architecture.md`.
- Future change planning: Correctly separated in `docs/action-plan.md` and `docs/tasks.md`.
- Target-state vision: Correctly separated in `docs/future-architecture.md`.

# Main Modules

- `src/modules/fiscal-documents/application/fiscal-document.service.ts`: fiscal orchestration for default issuance point configuration, sequence configuration, document creation, idempotency, sequence allocation, persistence, audit and response sanitization.
- `src/modules/fiscal-documents/domain/fiscal-key.generator.ts`: consecutive, clave and security-code generation.
- `src/modules/fiscal-documents/domain/scaled-decimal.ts`: fixed 5-decimal arithmetic.
- `src/modules/fiscal-documents/infrastructure/http/fiscal-public-documents.controller.ts`: `POST /invoices`, `POST /tickets`, `GET /fiscal-documents/:id`.
- `src/modules/fiscal-documents/infrastructure/http/fiscal-documents.controller.ts`: company-scoped create endpoints.
- `src/modules/fiscal-documents/infrastructure/http/fiscal-management.controller.ts`: JWT management endpoints.
- `prisma/schema.prisma`: final fiscal schema and constraints.
- `test/e2e/fase2/*`: fiscal workflow, management and concurrency E2E coverage.

# Main Dependencies

Primary runtime dependencies include NestJS, Prisma, PostgreSQL, class-validator/class-transformer, Swagger, JWT/passport, argon2, axios/cache-manager, Nest throttler, AWS SDK clients, pg-boss and pino.

Relevant build/test dependencies include TypeScript, Jest, ts-jest, Supertest, ESLint, Prettier, Prisma CLI and Nest CLI.

# Database Findings

## AUD-002

- Severity: Low
- Category: Database / Fiscal Constraints
- Location: `prisma/schema.prisma`, `prisma/migrations/20260912123000_post_f2_2_fiscal_constraints/migration.sql`
- Evidence: `FiscalDocument.consecutive` is not globally unique in the final Prisma model. The model defines `@@unique([tenantId, companyId, environment, consecutive])`. The migration drops `fiscal_documents_consecutive_key` and creates `fiscal_documents_tenant_company_environment_consecutive_key`. `clave` remains `@unique`. Legacy `fiscal_documents_tenant_company_idempotency_key` is dropped and replaced by non-unique `fiscal_documents_tenant_company_idempotency_key_idx`.
- Impact: Final DB constraint intent matches Post-F2.2 requirements. Different companies/environments may share the same 20-digit consecutive while Clave remains globally unique.
- Recommendation: No blocking change required. Keep historical migrations immutable and retain this forward migration.

## AUD-003

- Severity: Low
- Category: Database / Idempotency
- Location: `prisma/schema.prisma`, `prisma/migrations/20260911143000_fiscal_idempotency_scope/migration.sql`, `src/modules/fiscal-documents/application/fiscal-document.service.ts`
- Evidence: `FiscalIdempotencyKey` has `@@unique([tenantId, companyId, apiKeyId, operation, key])`. Service reservation uses `INSERT ... ON CONFLICT ("tenant_id", "company_id", "api_key_id", "operation", "key") DO NOTHING RETURNING "id"` before sequence allocation.
- Impact: Canonical idempotency scope is explicit and protects same key reuse across different API keys/operations without conflicting with `FiscalDocument` legacy uniqueness.
- Recommendation: Preserve reservation-before-sequence behavior.

## AUD-004

- Severity: Low
- Category: Database / Data Modeling
- Location: `prisma/schema.prisma` model `FiscalDocument`
- Evidence: Fiscal document `lines` and `totals` are JSON fields. No `fiscal_document_lines` table exists.
- Impact: Acceptable for current F2.2 snapshot behavior, but future reporting, validation or XML generation may be harder.
- Recommendation: Treat as non-blocking repository-level/future F2.3 data-model debt; do not classify as a Post-F2.2 regression.

# API Findings

## AUD-005

- Severity: Low
- Category: API / Response Contract
- Location: `FiscalDocumentService.toFiscalDocumentResponse()`, fiscal E2E tests
- Evidence: Service removes `securityCode` and `requestHash` and serializes top-level bigint values to strings. E2E helpers/tests assert sanitized responses. Response DTO classes exist for request bodies, but explicit fiscal response DTO/mappers are not yet present.
- Impact: Security-sensitive fields are not returned, resolving the prior Post-F2.2 exposure risk. Public response shape remains less formal than ideal.
- Recommendation: Non-blocking future work: formalize fiscal response DTO contracts without changing current behavior.

# Container Findings

## AUD-006

- Severity: Medium
- Category: Container / Deployment
- Location: `Dockerfile`, `docker-compose.yml`
- Evidence: Dockerfile is multi-stage, uses `node:20-alpine`, prunes dev dependencies and runs as non-root `billing`. Compose uses local credentials/defaults such as `billing_password`, `dev-jwt-secret-change-in-production-32chars`, `AWS_ACCESS_KEY_ID=test`, `AWS_SECRET_ACCESS_KEY=test`, and `NODE_ENV=production` for local services.
- Impact: Dockerfile posture is reasonable. Docker Compose must not be treated as production-ready due to default secrets/local service assumptions.
- Recommendation: Keep Compose clearly local/development-only or externalize/validate secrets before production use. This is pre-existing repository-level risk, not a Post-F2.2 regression.

# Security Findings

## AUD-007

- Severity: High
- Category: Security / Dependency Vulnerabilities
- Location: `package-lock.json`, user-provided `npm ci` / `npm audit` evidence
- Evidence: Current evidence states `npm ci` passes but `npm audit` still reports 26 pre-existing vulnerabilities.
- Impact: Dependency vulnerability exposure remains a repository-level security risk.
- Recommendation: Triage and remediate dependency vulnerabilities in a separate approved security task. Not a Post-F2.2 implementation blocker because it pre-existed this remediation.

## AUD-008

- Severity: Suggestion
- Category: Security / Fiscal Response Sanitization
- Location: `src/modules/fiscal-documents/application/fiscal-document.service.ts`, `test/e2e/fase2/fiscal-documents.e2e-spec.ts`
- Evidence: Fiscal document responses delete `securityCode` and `requestHash`; E2E tests call `expectSanitizedFiscalResponse()`.
- Impact: Prior sensitive fiscal response exposure is closed for the Post-F2.2 scope.
- Recommendation: Preserve this behavior. Future DTO work should continue excluding these fields from public responses.

# Testing Findings

## AUD-009

- Severity: Suggestion
- Category: Testing / Post-F2.2 Evidence
- Location: `test/e2e/fase2/fiscal-documents.e2e-spec.ts`, `test/e2e/fase2/fiscal-management.e2e-spec.ts`, `test/e2e/fase2/fiscal-concurrency.e2e-spec.ts`, canonical implementation report
- Evidence: Fiscal E2E covers invoice/ticket creation, negative paths, type-specific read scopes, idempotent replay/conflict, API-key operation scope, management endpoints and sanitization. Concurrency tests cover same-scope sequence uniqueness, identical idempotent races, different payload conflicts, shared consecutive across companies, environment isolation, document-type isolation and sequence initialization races.
- Impact: Strong Post-F2.2 regression confidence.
- Recommendation: Preserve these tests and keep clean DB reset/migration deployment evidence as part of future validation.

## AUD-010

- Severity: Medium
- Category: Testing / Repository-Level Evidence
- Location: `docs/current-state.md`, `docs/architecture.md`
- Evidence: Root docs retain Fase 1 evidence gaps for positive Hacienda query responses, rate-limit thresholds, CORS preflight and company verification statuses.
- Impact: These are repository-level gaps outside Post-F2.2. They reduce total repository release confidence but are not F2.2 remediation defects.
- Recommendation: Address in Fase 1 follow-up tasks; keep separated from Post-F2.2 closure.

# Maintainability Findings

## AUD-011

- Severity: Medium
- Category: Maintainability / Service Size
- Location: `src/modules/fiscal-documents/application/fiscal-document.service.ts`
- Evidence: One service currently handles management use cases, create/read use cases, validation, authorization checks, idempotency reservation, sequence allocation, calculations, persistence, response mapping and audit.
- Impact: Working behavior is concentrated in a large service, increasing future change risk and making isolated testing harder.
- Recommendation: Non-blocking future maintainability work. Do not treat as a Post-F2.2 regression because behavior is validated and stable.

## AUD-012

- Severity: Medium
- Category: Architecture / Framework-Persistence Coupling
- Location: `src/modules/fiscal-documents/application/fiscal-document.service.ts`
- Evidence: Fiscal application service injects and uses `PrismaService` directly, including raw SQL.
- Impact: Coupling to Prisma/PostgreSQL is explicit in application orchestration. This is acceptable for the current compact implementation but deviates from the repository's broader incremental hexagonal convention.
- Recommendation: Future architecture work may separate persistence responsibilities, but no redesign is required for Post-F2.2 closure.

# Technical Debt

- Large fiscal application service with multiple responsibilities.
- Direct Prisma/raw SQL use from fiscal application service.
- No explicit fiscal response DTO classes/mappers.
- Fiscal lines/totals stored as JSON snapshots.
- No DB partial unique index guaranteeing exactly one default issuance point per company/environment.
- Pre-existing npm audit vulnerabilities.
- Docker Compose default secrets/local-production-mode ambiguity if reused outside development.
- Fase 1 rate-limiting and endpoint evidence gaps remain repository-level debt.

# Behavior to Preserve

- Post-F2.2 canonical owner remains `specs/post-f2-2-remediation/`.
- Fase 1 Post-F2.2 sections remain historical/misclassified records only.
- F2.2 fiscal document creation stops at `READY_FOR_XML`.
- No XML generation, XSD validation, XAdES signing, Hacienda submission, polling, callbacks, PDF, email or webhook side effects occur in F2.2/Post-F2.2.
- Fiscal consecutive format remains branch + terminal + document-type code + 10-digit sequence.
- Fiscal consecutive uniqueness remains scoped by tenant/company/environment/consecutive.
- `clave` remains globally unique.
- Fiscal sequence allocation remains atomic and does not use `SELECT MAX + 1`.
- Canonical idempotency reservation occurs before sequence allocation.
- Same idempotency key/same canonical request returns the original fiscal document.
- Same canonical idempotency key with a different request is rejected.
- Same textual idempotency key may be reused across different API keys or operations when the canonical scope differs.
- API-key/company authorization remains fail-closed.
- Fiscal responses do not expose `securityCode` or `requestHash`.
- Bigint fiscal fields in top-level responses serialize as strings.

# Known Defects

No blocking Post-F2.2-specific defect was found.

Repository-level known defects retained outside Post-F2.2:

- Auth/API rate-limiting behavior and Fase 1 endpoint evidence remain under-characterized in docs.
- `npm audit` reports 26 pre-existing vulnerabilities.

# Architectural Debt

- `FiscalDocumentService` combines too many responsibilities but currently works.
- Fiscal service depends directly on Prisma and raw SQL.
- Authorization policies for fiscal management and dynamic read scopes are embedded in the service rather than expressed as reusable policies/guards.
- Fiscal response contracts are sanitized objects rather than explicit response DTOs.
- Fiscal document lines are JSON snapshots, not relational rows.

# Unknown Behavior

- This audit did not independently execute validation commands; command status is based on recorded/user-provided evidence.
- Live production migration behavior against a database containing duplicate values in the new scoped uniqueness columns was not independently tested; clean `billing_e2e` migration deployment is recorded as passing.
- Exact production dependency vulnerability exploitability has not been triaged.
- Whether JSON fiscal lines are acceptable beyond F2.2 remains a future product/architecture decision.
- Whether a partial unique constraint for one default issuance point per company/environment is required remains a future DB decision.

# Critical Risks

No Critical risk and no blocking Post-F2.2-specific risk were found.

Highest non-blocking risks:

- High repository-level dependency vulnerability risk from `npm audit` findings.
- Medium maintainability risk from the large Prisma-backed fiscal service.
- Medium repository-level deployment risk if `docker-compose.yml` is reused as production configuration.

# Recommended Priorities

1. Do not reopen Post-F2.2 for the inspected fiscal constraints; treat the remediation as closed unless new runtime evidence contradicts the recorded validation.
2. Preserve canonical ownership under `specs/post-f2-2-remediation/`.
3. Triage pre-existing `npm audit` vulnerabilities in a separate security task.
4. Preserve and run fiscal E2E/concurrency suites on clean PostgreSQL databases in CI/local validation.
5. In future architecture work, address `FiscalDocumentService` size, explicit fiscal response DTOs, persistence boundaries and default issuance-point uniqueness only as non-blocking debt.
6. Keep Fase 1 rate-limiting/evidence gaps separated from Post-F2.2 remediation closure.

# Final Verdict

Overall Score: 9.0/10.

Final Post-F2.2 verdict: no blocking Post-F2.2-specific regression found. Final DB constraint documentation matches schema and migration intent. Canonical documentation ownership is reconciled and no longer incorrectly assigns Post-F2.2 ownership to `specs/fase-1-hacienda-consultas/`.

Acceptable
