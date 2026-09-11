# Changelog — Billing API

## [phase-9-audit-architecture-refresh] — 2026-11-09

**Agent:** sdd-implementation-agent-c13b28
**Spec:** `specs/fase-1-hacienda-consultas` (post-pre-fase-2-hardening cumulative baseline)

### Documentation
- Post-implementation baseline audit ejecutado via `baseline-audit-agent`; score inicial 8.2/10 **corregido a 8.8/10** (CI/CD y Documentation tenían scores erróneos por bug de tool; ver `docs/audit/current-code-audit.md`).
- `docs/audit/current-code-audit.md` created with 7 open findings (AUD-D02, AUD-API01, AUD-SEC01, AUD-API04, AUD-DB01, AUD-SEC02, DEFECT-001) — all requiring separately approved specs.
- Architecture documentation refreshed via `hdd-architecture-agent`:
  - `docs/current-state.md` — updated to 163 tests / 8.2/10 / all 5 phases documented.
  - `docs/architecture.md` — active decisions + 8 known limitations + open clarifications.
  - `docs/action-plan.md` — stages 0-1 complete; stages 2-5 proposed.
  - `docs/tasks.md` — TASK-008 completed; TASK-009 through TASK-017 added as Proposed.
  - `docs/future-architecture.md` — fase-2-2-fiscal-document-core as next milestone.
- `specs/fase-1-hacienda-consultas/implementation-report.md` — Section 19 added recording Phase 9 results.

### Validation (current baseline)
- Tests: **163 passed / 0 failed** (24 suites)
- TypeScript: 0 errors
- Lint: 0 errors
- Build: clean

---

## [pre-fase-2-hardening] — 2026-10-09

**Agent:** sdd-implementation-agent-c13b28
**Spec:** `specs/pre-fase-2-hardening/`

### Security
- **SEC-001 FIXED:** CORS wildcard (`*`) is now a fatal startup error in `production` and `staging` environments, enforced by the Joi validation schema. Previously was warn-only at runtime.
- **R-13 PARTIAL:** Removed signed fiscal XML from git index (`git rm --cached`); added `SIGNED_*.xml` to `.gitignore`; moved file to `test/fixtures/`. **Git history purge still required** (manual `git filter-repo`).

### Features / Improvements
- **DEF-001 FIXED:** `.env.local.example` now documents all 31+ environment variables with inline comments, organized by section.
- **DEF-002 FIXED:** `docker-compose.yml` billing-api service now includes `CORS_ALLOWED_ORIGINS` with shell-variable substitution defaulting to `http://localhost:3000`.
- **SEC-006 FIXED:** `HaciendaCircuitBreaker` now accepts `ConfigService` injection (`@Optional()`); all 7 resilience parameters (failure threshold, reset timeout, outbound rate, 429/5xx retry counts and delays) are fully configurable via environment variables with production-safe defaults.
- **CI-001 FIXED:** Explicit `npx prisma generate` step added to `lint` and `typecheck` CI jobs.
- Added `USE_REAL_HACIENDA=false` to CI E2E job environment.

### Architecture
- Extracted Joi validation schema to `src/infrastructure/config/config.validation-schema.ts` — standalone module testable without NestJS bootstrap.
- `config.module.ts` imports and re-exports `validationSchema` for backward compatibility.
- `api.main.ts` now uses `ConfigService` exclusively; no direct `process.env` reads remain in bootstrap code.
- `LocalStorageAdapter` constructor no longer reads `process.env`; values passed via `StorageModule` → `ConfigService`.
- `StorageConfig` and `HaciendaConfig` interfaces extended with typed sub-objects.

### Tests
- **+10 unit tests:** `src/infrastructure/config/__tests__/config.validation.spec.ts` — covers CORS production guard, JWT entropy rule, CB defaults, outbound rate cap.
- **+6 unit tests:** `src/infrastructure/integrations/hacienda/__tests__/hacienda-circuit-breaker.spec.ts` updated — `makeBreaker()` helper; configurable threshold (AC-005), reset timeout (AC-006), rate limiter (AC-007), retry exhaustion.
- Total tests: **141** (was 126).
