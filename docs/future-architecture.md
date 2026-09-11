# Future Architecture

> **Synchronized:** post `pre-fase-2-hardening`.
> This document describes proposed future-state architecture only. None of the items here are approved or implemented.
> For currently implemented architecture, see `docs/architecture.md`.
> For the migration plan and proposed tasks, see `docs/action-plan.md` and `docs/tasks.md`.

---

## 1. Vision Summary

Billing should evolve as an **API-first modular monolith** with explicit domain boundaries, strict tenant isolation, fully auditable fiscal workflows, and resilient asynchronous processing where Hacienda or document generation introduces latency or retry requirements.

The next major capability milestone is `specs/fase-2-2-fiscal-document-core`: generating, signing, and submitting Costa Rica Hacienda v4.4 electronic fiscal documents.

Before that feature, the architecture needs targeted hardening of the open audit findings (AUD-API01, AUD-SEC01, AUD-API04, AUD-DB01, AUD-SEC02, DEFECT-001) and a technical spike to select the XAdES-EPES XML signing library (ADR-005).

---

## 2. Business and Technical Drivers

- Costa Rica Ministerio de Hacienda v4.4 compliance for electronic invoicing (FE, FEE, TE, etc.).
- Stable Billing-owned API contracts for external integrators (POS, ERP, e-commerce, Inventori).
- Per-company Hacienda credentials (not global) — already implemented in HaciendaConnection.
- Fiscal auditability: ≥5-year retention for `FISCAL_AUDIT` events.
- Resilience against Hacienda API unavailability — already implemented with HaciendaCircuitBreaker.
- Incremental modernization without microservices decomposition.
- Current baseline: 8.2/10 audit score — targeted improvement before next major feature.

---

## 3. Target Architectural Style

- **Modular monolith** remains the target. No microservices until there is a measurable operational justification.
- **Hexagonal architecture** becomes stricter over time:
  - Domain models own invariants and business language.
  - Application use cases orchestrate domain objects through port interfaces only.
  - Infrastructure adapters implement all output ports.
  - Controllers remain pure input adapters (no business logic).
- **Separate API and worker processes** from the same compiled codebase — scale independently.
- **PostgreSQL** remains the primary database and queue backend (pg-boss) unless a specific scaling need requires change.
- **No framework imports in domain or application layers** — strictly enforced for new code.

---

## 4. Target Domain Map and Bounded Contexts

### Currently Implemented (Fase 0–2.1 + Hardening)
| Bounded Context | Status |
|---|---|
| Identity and Access (tenants, users, auth, API keys) | ✅ Implemented |
| Company Administration (companies, identification) | ✅ Implemented |
| Hacienda Integration Gateway (public queries, circuit breaker, caching) | ✅ Implemented |
| Hacienda Connection (per-company OIDC credentials) | ✅ Implemented |
| Audit and Compliance | ✅ Implemented (application-level) |

### Proposed Future Bounded Contexts
| Bounded Context | Planned Phase | Description |
|---|---|---|
| Fiscal Documents | fase-2-2-fiscal-document-core | Document creation, consecutive key generation, XML generation, idempotency |
| Fiscal Processing | fase-2-2 / fase-3 | Hacienda XML signing, submission, status polling, acceptance/rejection handling |
| Document Artifacts | fase-2-2 / fase-3 | XML storage, PDF generation (optional), Hacienda response storage |
| Webhook / Notification Delivery | future | Outbound webhooks for document status changes; retries, signatures, auditability |
| Payments and Receipts | future | Out of current scope; roadmap item |

---

## 5. Proposed Use Cases and Responsibilities

### Near-Term (Audit Remediation — no new domain)
- Add tenant ownership enforcement on `GET /tenants/:id` (TASK-011).
- Add HTTP security headers via helmet (TASK-012).
- Fix `expiresIn` in `RefreshTokenHandler` (TASK-016).
- Implement first worker job handler (TASK-013).
- DB-level audit append-only enforcement (TASK-014).
- Shared Hacienda token cache (TASK-015).

### fase-2-2-fiscal-document-core (Proposed — requires approved spec)
- `CreateFiscalDocument`: validate input, generate consecutive key, build XML, write to `fiscal_documents` table with `PROCESSING` status and idempotency key.
- `SignFiscalDocument`: retrieve XML, sign with XmlSignerPort (XAdES-EPES), update document status.
- `SubmitFiscalDocumentToHacienda`: authenticate via `HaciendaConnectionModule.HaciendaTokenCache`, call Hacienda submission endpoint, record response.
- `PollHaciendaDocumentStatus`: query Hacienda status endpoint, transition document to ACCEPTED/REJECTED.
- `GetFiscalDocument`: retrieve document and its current status.

---

## 6. Proposed Ports and Adapters

### Ports Needed for fase-2-2
| Port | Description | Status |
|---|---|---|
| `XmlSignerPort` | XAdES-EPES signature — interface already defined | Stub (ADR-005 spike pending) |
| `FiscalDocumentRepository` | Append/query fiscal documents | Not yet defined |
| `IdempotencyRepository` | Store/check idempotency keys per operation | Not yet defined |
| `ConsecutiveKeyGenerator` | Generate valid Hacienda consecutive keys | Not yet defined |

### Existing Ports to Reuse
| Port | Current Use | Reuse Plan |
|---|---|---|
| `HaciendaPort` | Public queries (Fase 1) | Extend with `submitDocument`, `getDocumentStatus` (stubs already defined in interface) |
| `HaciendaAuthPort` | Connection token management | Reuse for authenticated document submission |
| `StoragePort` | Local / S3 storage | Reuse for XML/PDF artifact storage |
| `AuditService` | HTTP event audit | Reuse with `FISCAL_AUDIT` event class for document lifecycle events |
| `JobQueuePort` | Queue | Reuse for async submission/polling jobs |

---

## 7. Proposed Data Ownership

| Domain | Owns |
|---|---|
| Identity | tenants, users, refresh_tokens |
| Companies | companies |
| API Keys | api_keys, api_key_companies |
| Hacienda Connection | hacienda_connections |
| Audit | audit_logs (append-only) |
| Fiscal Documents (future) | fiscal_documents, fiscal_document_artifacts, idempotency_records |

**Rule:** No module may write to another module's tables directly. Cross-module reads only through exported handlers or events.

---

## 8. Proposed API and Integration Model

- **Preserve** `/api/v1` backward compatibility for all currently implemented endpoints.
- **Fiscal document endpoints** will be under `/api/v1/fiscal-documents` (new, additive).
- **Idempotency:** fiscal document creation must accept an `Idempotency-Key` header (already in CORS `allowedHeaders`) and return a deterministic response for duplicate requests.
- **Asynchronous model:** document submission to Hacienda is async; API returns `PROCESSING` status immediately; clients poll `GET /api/v1/fiscal-documents/:key` or receive webhook callback.
- **Hacienda submission errors** must be mapped to Billing-owned error codes (BR-012 extended to submission domain).

---

## 9. Proposed Security Boundaries

- Extend current security model to fiscal documents:
  - API keys with a `fiscal-documents:write` scope for document creation (new scope).
  - JWT-protected admin endpoints for document history/management.
  - `FISCAL_AUDIT` event class for all document lifecycle events (creation, signing, submission, acceptance, rejection).
- **XAdES-EPES signing:** PKCS#12 certificate data must never be logged, stored in DB, or returned by API. Lifecycle: retrieve from SecretProvider → sign in memory → discard. (Already enforced in `XmlSignerPort` contract comment.)
- Add `helmet` (TASK-012) before new endpoints go live.
- Fix cross-tenant read risk (TASK-011) before fiscal documents are available.

---

## 10. Proposed Deployment Architecture

- **API and worker remain separate processes** from the same monolith codebase.
- Scale API and worker containers independently based on HTTP load vs. job queue depth.
- **PostgreSQL health and migration deployment** remain release gates (already in CI).
- **Deployment step** to be added to CI/CD for automated staging deployments (TASK-017 prerequisite).
- **Recommended production stack:** ECS Fargate (or equivalent container platform) with RDS PostgreSQL (managed, with read replicas if needed), and potentially ElastiCache Redis if TASK-015 uses Redis.

---

## 11. Migration Assumptions

- **Never edit applied migrations.** Always create new migrations.
- **Each new feature phase** introduces its own migration(s).
- **Migrations must be backward-compatible** unless explicitly approved as breaking.
- **CI must include `npx prisma migrate deploy`** before running E2E tests (already implemented).
- **Hacienda token storage migration (TASK-015):** Must be designed so that existing `hacienda_connections` data remains valid.
- **Fiscal document tables (fase-2-2):** Additive only; no changes to existing tables.

---

## 12. Risks and Trade-offs

| Risk | Severity | Notes |
|---|---|---|
| XmlSignerPort library selection (ADR-005) | High | Must complete technical spike before implementing fiscal document signing. No implementation without spike results. |
| Fiscal document XML correctness | High | Hacienda v4.4 schema has strict validation. Invalid XML = document rejection = fiscal non-compliance. Requires comprehensive tests against Hacienda sandbox. |
| Hexagonal boundary discipline | Medium | Modular monolith can degrade into a "big ball of mud" if internal boundary discipline is not enforced by code review and linting. |
| AUD-DB01 (audit tampering) | Medium | If fiscal audit records can be tampered with, compliance guarantees are voided. TASK-014 must be done before fiscal documents go live. |
| AUD-SEC02 (token storm) | Medium | Multi-instance deployment risks Hacienda IDP rate limits. TASK-015 should be done before scaling beyond one API instance. |
| Stage 5 scope creep | High | Fiscal document lifecycle is complex (FE, FEE, TE, NC, ND, etc.). Enforce spec-driven discipline; implement one document type at a time. |

---

## 13. Open Questions

1. **XmlSignerPort (ADR-005):** Which XAdES-EPES library? (`xmldsigjs`, Java-based `xades4j` via subprocess, `node-xades`, custom implementation?) Technical spike required before any fiscal document implementation begins.
2. **AUD-API01 response code:** Should `GET /tenants/:id` cross-tenant access return 403 (explicit denial) or 404 (to prevent tenant enumeration)? Must decide before implementing TASK-011.
3. **AUD-DB01 mechanism:** PostgreSQL trigger vs. append-only DB role vs. RLS? Each has different operational tradeoffs. DBA decision required.
4. **AUD-SEC02 backend:** Redis (new dependency) vs. PostgreSQL token table (no new infra) vs. SSM (high latency)? Decision depends on deployment topology.
5. **Worker job types:** What is the first job type to implement in TASK-013? Recommendation: a Hacienda connection health-check polling job (non-fiscal, low risk, validates the full worker pipeline).
6. **Fiscal document types for fase-2-2:** Which document type(s) first? FE (Factura Electrónica) is the most common; recommended as the first type.
7. **CD pipeline target:** Where is the application deployed in production? ECS? Railway? Render? Kubernetes? Answer determines TASK-017 scope.
8. **JWT token blacklisting:** Currently, logout does not invalidate JWT access tokens (only refresh tokens are stored). Is JWT blacklisting or short-lived access tokens with no blacklist the accepted model?
