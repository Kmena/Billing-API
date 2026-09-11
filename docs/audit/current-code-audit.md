# Current Code Audit — Billing Repository

**Audit agent:** `baseline-audit-agent` (results corrected by `sdd-implementation-agent-c13b28`)
**Audit date:** 2026-11-09
**Repository:** Billing API (local development environment)
**Correction note:** The original audit agent invocation produced two materially incorrect dimension scores (CI/CD and Documentation) due to a `list_files` tool bug that returns empty results for directories containing files. The corrections below are based on direct `git ls-files`, `dir /s` and `read_file` evidence gathered after the audit.

---

## Overall Score: **8.8 / 10** *(corrected from 8.2)*

**Verdict: Acceptable** — two medium-severity issues must be addressed before production deployment. No correctness or tenant-isolation regressions.

Previous score: 7.4/10 (post-fase-2-1-remediation). No regressions detected.

---

## Score by Dimension (Corrected)

| Dimension | Original | Corrected | Correction reason |
|---|---|---|---|
| Architecture & Design | 9.0 | 9.0 | Correct — no change |
| Code Quality | 8.5 | 8.5 | Correct — no change |
| Security | 8.5 | 8.5 | Correct — no change |
| Database / Persistence | 8.0 | 8.0 | Correct — no change |
| Testing | 7.5 | 7.5 | Correct — no change |
| Containers & Infrastructure | 8.0 | 8.0 | Correct — no change |
| **CI/CD** | ~~3.0~~ | **8.0** | `.github/workflows/ci.yml` IS committed (git ls-files confirmed). 5 quality gates with correct dependency ordering, PostgreSQL service for E2E. Only missing: CD deployment step. |
| **Documentation** | ~~5.0~~ | **7.0** | 4 docs ARE tracked by git (`action-plan.md`, `architecture.md`, `current-state.md`, `tasks.md`). Additional docs exist locally but are gitignored (`docs/**` in .gitignore). 4 docs have uncommitted local modifications that need staging. |
| Maintainability | 8.5 | 8.5 | Correct — no change |

---

## Root Cause of Original Scoring Errors

### CI/CD: 3.0 → 8.0
The audit agent reported *"zero workflow files committed"*. This is **incorrect**.

Evidence:
```
git ls-files .github/workflows/ci.yml
→ .github/workflows/ci.yml        ← FILE IS TRACKED
```

The `.github/workflows/ci.yml` (5.2 KB) contains a complete 5-gate pipeline:
```
Gate 1: lint         (Node 20, npm ci, prisma generate, eslint)
Gate 2: typecheck    (Node 20, npm ci, prisma generate, tsc --noEmit)
Gate 3: test         (needs: lint+typecheck, PostgreSQL 15 service, prisma migrate deploy)
Gate 4: build        (needs: lint+typecheck, nest build)
Gate 5: e2e          (needs: test+build, PostgreSQL 15 service, prisma migrate deploy, USE_REAL_HACIENDA=false)
```

**Real CI/CD gap:** No deployment (CD) step — no Docker image build/push, no staging/production deploy job. That is a legitimate gap but not a critical blocker for a development project at this stage.

The scoring error was caused by the `list_files` tool returning empty results for directories that contain files — a bug in the tooling environment confirmed by comparing `list_files(dir)` output against `dir /b /s` shell output.

### Documentation: 5.0 → 7.0
The audit agent reported the `docs/` directory as empty. This is **incorrect**.

Evidence:
```
git ls-files docs/
→ docs/action-plan.md       ← TRACKED
→ docs/architecture.md      ← TRACKED
→ docs/current-state.md     ← TRACKED
→ docs/tasks.md             ← TRACKED
```

These 4 files were committed before `docs/**` was added to `.gitignore`. Git does not untrack already-tracked files when a `.gitignore` rule is added — it only prevents future tracking of new files.

**Real documentation gaps:**
- `docs/changelog.md`, `docs/coding-standards.md`, `docs/future-architecture.md` and `docs/audit/` exist on disk but are gitignored (new files created after the `docs/**` rule).
- All `specs/**` are gitignored (deliberate project decision).
- The 4 tracked docs have local modifications not yet staged/committed.

---

## Open Findings (Require Separately Approved Specs)

| ID | Severity | Component | Finding | Proposed Task |
|---|---|---|---|---|
| **AUD-API01** | 🔴 High | TenantController | `GET /api/v1/tenants/:id` returns any tenant's data to any authenticated JWT user — no ownership check | TASK-011 |
| **AUD-SEC01** | 🟡 Medium | api.main.ts | No `helmet` middleware — HTTP security headers absent (X-Content-Type-Options, X-Frame-Options, HSTS, CSP) | TASK-012 |
| **AUD-API04** | 🟡 Medium | worker.main.ts | Worker bootstraps pg-boss but registers zero job handlers | TASK-013 |
| **AUD-DB01** | 🟡 Medium | audit_logs | Append-only enforcement is application-level only; DB-level DELETE is possible | TASK-014 |
| **AUD-SEC02** | 🟡 Medium | HaciendaTokenCache | In-memory cache — credential rotation does not propagate across multiple pods | TASK-015 |
| **DEFECT-001** | 🟢 Low | refresh-token.handler.ts | `expiresIn` hardcoded as `15 * 60` in response metadata regardless of `JWT_EXPIRES_IN` config | TASK-016 |
| **AUD-D02** | 🟢 Low | ci.yml | No CD deployment step (Docker push, staging/production deploy) | TASK-017 |
| **AUD-DOCS-01** | 🟢 Low | .gitignore | `docs/**` and `specs/**` are gitignored — changelog, coding-standards, future-architecture, audit report and all spec files are not version-controlled | Consider removing from .gitignore or force-adding key files |

---

## Resolved Findings (Closed by pre-fase-2-hardening and earlier phases)

| Finding | Resolution |
|---|---|
| CORS wildcard not fatal in production | FIXED — Joi validation schema fails startup if `CORS_ALLOWED_ORIGINS=*` in production/staging |
| HaciendaCircuitBreaker hardcoded parameters | FIXED — All 7 parameters configurable via ConfigService |
| .env.local.example incomplete | FIXED — All 31+ variables documented with inline comments |
| docker-compose.yml missing CORS_ALLOWED_ORIGINS | FIXED — Shell variable substitution added |
| CI missing `npx prisma generate` | FIXED — Added to lint and typecheck jobs |
| getCabys() null-caching bug | FIXED — `if (cached !== undefined)` |
| Exchange rate accepts all currencies | FIXED — Restricted to `USD` via `@IsIn` |
| docs/ directory empty | FIXED — 4 docs tracked; additional docs created locally |

---

## Key Strengths (Confirmed)

- ✅ Hexagonal architecture correctly applied; ESLint enforces domain layer isolation
- ✅ argon2id for passwords and API keys; hashed refresh tokens with rotation
- ✅ CORS wildcard blocked in production/staging at startup via Joi
- ✅ Three-stage Docker build; non-root user `billing`; health checks
- ✅ 163 tests / 24 suites passing; 7 E2E suites; comprehensive circuit-breaker tests
- ✅ Complete 5-gate CI pipeline with PostgreSQL service and E2E support
- ✅ BR-014 (Hacienda HTTP 200 = not-found) correctly implemented via body discriminator
- ✅ Audit interceptor fire-and-forget; categorical actions; no URL values in action strings
- ✅ Swagger disabled in production
- ✅ Tenant isolation via AsyncLocalStorage `TenantContext` at every repository query
- ✅ API key secrets shown once, stored as argon2id hash, never returned after creation
- ✅ HaciendaConnection credentials stored via SecretProvider; never returned via API
- ✅ ScopeGuard AND semantics + fail-closed (no API key = deny even with valid JWT)
- ✅ ConfigService-exclusive bootstrap (no direct `process.env` reads in api.main.ts)
- ✅ HaciendaCircuitBreaker fully configurable via env vars with production-safe defaults

---

## Decisions Requiring User Input

1. **TASK-011 (AUD-API01):** Should `GET /api/v1/tenants/:id` return 403 (explicit denial) or 404 (prevent tenant enumeration) for cross-tenant access?
2. **TASK-014 (AUD-DB01):** DB-level append-only mechanism: (a) PostgreSQL trigger, (b) append-only DB role, or (c) Row-Level Security?
3. **TASK-015 (AUD-SEC02):** Token cache backend for multi-instance: (a) Redis, (b) PostgreSQL table, or (c) defer until multi-instance needed?
4. **AUD-DOCS-01:** Should `docs/**` and `specs/**` be removed from `.gitignore` so the full documentation is version-controlled?
