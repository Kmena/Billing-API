# Current State

> **Synchronized:** Final F3 Hacienda asynchronous submission documentation refresh by `hdd-architecture-agent-4f9f0f` on 2026-09-14 for confirmed `specs/fase-3-hacienda-async-submission`. Documentation-only refresh; no production code, tests, Prisma schema or migrations changed by this agent.
>
> **Validation evidence recorded from completed implementation/audit cycle:** final audit **Acceptable 8.6/10**; `npm ci`, Prisma generate/validate/migrate deploy on clean PostgreSQL 15, lint, lint:check, typecheck, unit, build, E2E and Docker build passed. Unit evidence: **49 suites / 349 tests**. E2E evidence: **15 suites / 85 tests**. Focused F3 evidence: **13 suites / 122 tests** plus focused F3 E2E **14 tests**. `npm audit` still reports **26 known vulnerabilities** unrelated to new F3 dependencies.

## 1. System overview

Billing is a multi-tenant Costa Rica electronic invoicing API implemented as a NestJS/TypeScript modular monolith with Prisma/PostgreSQL persistence, API and worker entrypoints, object storage, secrets abstraction and pg-boss-backed queueing.

Implemented/current capabilities:

| Area | Current implemented capability |
|---|---|
| Foundation | Tenants, users, JWT authentication, refresh tokens, API keys, company management, audit log, health checks, validated configuration and Prisma/PostgreSQL. |
| Hacienda public queries | Taxpayer, CABYS and exchange-rate lookup modules with Hacienda integration ports/adapters and mock support. |
| Hacienda connection | Per-company/per-environment credential lifecycle and connection validation; OIDC auth adapter, process-local token cache and `SecretProvider` integration. |
| Fiscal document core | Issuance points, sequences, immutable FE/TE fiscal documents, idempotent API creation, fiscal snapshots and `READY_FOR_XML`. |
| Fiscal XML/signing | FE/TE v4.4 XML serialization from snapshots, XSD 1.1 validation, PKCS#12/PFX signing, local verification and private XML artifact persistence ending in `READY_TO_SUBMIT`. |
| Hacienda asynchronous submission (F3) | Submission state machine, retry classifier, `FiscalSubmission` persistence, `HaciendaSubmissionPort`, mock/real recepcion adapters, submit/status/reconcile/callback APIs, queue worker registration, submit/reconcile worker paths, response artifact persistence, audit/observability/security/concurrency/E2E coverage. |

Phase status:

| Phase | Status |
|---|---|
| Foundation | Complete |
| Fase 1 Hacienda consultas | Complete with earlier deferred repository risks |
| F2.1 Hacienda Connection | Complete |
| F2.2 Fiscal Document Core | Complete |
| F2.3 XML/XSD/XAdES | Complete for confirmed local prepare/sign/verify/XSD scope |
| F3 Hacienda async submission | Complete functionally; audit Acceptable 8.6/10 |
| F4 PDF/email/delivery | Not introduced |

## 2. Repository structure

Relevant current structure:

```text
Billing/
├── Dockerfile
├── docker-compose.yml
├── prisma/
│   ├── schema.prisma
│   └── migrations/
│       └── 20260914193000_fiscal_submission/
├── resources/hacienda/v4.4/
├── specs/fase-3-hacienda-async-submission/
├── src/bootstrap/
│   ├── api.main.ts
│   └── worker.main.ts
├── src/infrastructure/
│   ├── config/hacienda-submission.config.ts
│   ├── queue/
│   ├── secrets/
│   └── storage/
├── src/modules/fiscal-documents/
│   ├── application/fiscal-xml/
│   ├── application/submission/
│   ├── domain/submission/
│   └── infrastructure/{http,submission,xml}/
├── src/modules/hacienda-connection/
└── test/e2e/fase3/
```

## 3. Current architecture

The system is an API-first modular monolith with incremental hexagonal/ports-and-adapters practices. F3 adds a Hacienda submission submodule inside the existing fiscal-documents boundary.

Implemented F3 dependency flow:

```text
FiscalSubmissionController / HaciendaCallbackController
  -> submission application services
    -> FiscalSubmissionStateMachine / RetryClassifier
    -> Prisma persistence
    -> JobQueuePort
    -> StoragePort
    -> HaciendaConnection + SecretProvider + HaciendaAuthPort + HaciendaTokenCache
    -> HaciendaSubmissionPort
      <- MockHaciendaSubmissionAdapter or HaciendaRecepcionAdapter
```

Worker process uses the same `AppModule` as an application context and registers F3 submit/reconcile handlers through `JobQueuePort.registerHandler` when available.

## 4. Existing domains and modules

| Domain / Module | Responsibility | Current code location |
|---|---|---|
| Identity and access | Tenants, users, JWT, refresh tokens, API keys, scopes and company authorization. | `src/modules/identity`, `src/modules/api-keys` |
| Companies | Company identity and fiscal profile/readiness data. | `src/modules/companies` |
| Hacienda public queries | Taxpayer, CABYS and exchange-rate lookups. | `src/modules/taxpayers`, `src/modules/cabys`, `src/modules/exchange-rates` |
| Hacienda connection | Credential references, validation, OAuth/OIDC auth and token cache. | `src/modules/hacienda-connection` |
| Fiscal documents | Issuance, immutable snapshots, XML readiness, submission lifecycle and terminal Hacienda outcome. | `src/modules/fiscal-documents` |
| Fiscal XML/signing | Hacienda v4.4 FE/TE XML, signing, validation and XML artifacts. | `src/modules/fiscal-documents/**/fiscal-xml`, `src/infrastructure/signing` |
| Fiscal submission | Asynchronous Hacienda submission, polling/reconciliation, callback signals and response artifacts. | `src/modules/fiscal-documents/**/submission` |
| Audit | Audit event recording. | `src/modules/audit` |
| Infrastructure | Config, database, queue, secrets, storage, tenant context and integrations. | `src/infrastructure` |

## 5. Main use cases

Implemented fiscal use cases include:

1. Configure fiscal issuance point and sequence with JWT tenant administration.
2. Create FE invoice using API key `invoices:write`; persists immutable `FiscalDocument` at `READY_FOR_XML`.
3. Create TE ticket using API key `tickets:write`; persists immutable `FiscalDocument` at `READY_FOR_XML`.
4. Prepare XML with `POST /api/v1/fiscal-documents/:id/prepare-xml`; signs, verifies, XSD-validates and stores signed XML; reaches `READY_TO_SUBMIT`.
5. Request Hacienda submission for `READY_TO_SUBMIT` FE/TE using invoice/ticket submit routes; creates/reuses one `FiscalSubmission` and enqueues durable work.
6. Process submit jobs: verify signed XML hash, acquire Hacienda token through existing auth components, call Hacienda submission port, classify result and persist state.
7. Reconcile submission status by Clave through Hacienda `GET /recepcion/{clave}` until authoritative `ACCEPTED` or `REJECTED`, retry/manual-review horizon, or continued non-terminal processing.
8. Handle public Hacienda callback as signal-only by Clave and enqueue reconciliation rather than trusting callback as terminal proof.
9. Persist exact Hacienda `respuesta-xml` decoded bytes and SHA-256/content metadata for F4/audit.
10. Retrieve current submission status and request manual reconciliation for non-terminal submissions.

## 6. Current data flows

### FE/TE creation to readiness

API-key client creates invoice/ticket; service reserves idempotency, allocates sequence/consecutive/Clave, snapshots fiscal data and persists `READY_FOR_XML`. `/prepare-xml` serializes from immutable snapshot, signs, verifies, validates against pinned XSDs, stores XML artifacts privately and transitions to `READY_TO_SUBMIT`.

### F3 submit flow

1. API client calls `POST /api/v1/companies/:companyId/fiscal-documents/:environment/invoices/:id/submit` or `/tickets/:id/submit`.
2. Guards require API key and `invoices:write`/`tickets:write`; service verifies tenant/company/environment/type ownership.
3. Service checks `READY_TO_SUBMIT`, signed XML artifact/key/hash, enabled matching Hacienda connection and environment isolation.
4. Service creates or reuses unique `FiscalSubmission`, snapshots signed XML key/hash, publishes queue work and returns sanitized state.
5. Worker submits exact signed XML through `HaciendaSubmissionPort`; HTTP 201 is acknowledgement/pending only.
6. Worker schedules reconciliation or retry according to `RetryClassifier`.
7. Authoritative `aceptado`/`rechazado` status transitions submission and document to `ACCEPTED`/`REJECTED`, persists response artifact and audit metadata.

### Callback flow

`POST /api/v1/hacienda/callback` accepts provider callback JSON, extracts/validates Clave when possible and publishes reconciliation work. Tenant/company identity is resolved from persisted Clave/submission mapping, not from callback body. Callback is not trusted as a terminal update by itself.

## 7. Database and persistence

Current fiscal persistence includes:

- `FiscalDocumentStatus`: `READY_FOR_XML`, `XML_GENERATED`, `XML_VALIDATED`, `SIGNED`, `READY_TO_SUBMIT`, `ACCEPTED`, `REJECTED`.
- `FiscalSubmissionStatus`: `REQUESTED`, `QUEUED`, `SUBMITTING`, `POST_OUTCOME_UNKNOWN`, `ACKNOWLEDGED`, `PROCESSING`, `ACCEPTED`, `REJECTED`, `TECHNICAL_RETRY_PENDING`, `MANUAL_REVIEW_REQUIRED`.
- `FiscalSubmission`: one row per fiscal document (`fiscalDocumentId` unique) and one row per Clave (`clave` unique). Stores tenant/company/document/environment/type, signed XML key/hash snapshot, counters/timestamps, provider metadata, sanitized error metadata, response artifact key/hash/content type/receivedAt and optimistic `version`.

Important constraints/indexes:

- `FiscalDocument.clave` globally unique.
- `FiscalDocument` scoped consecutive uniqueness: `(tenantId, companyId, environment, consecutive)`.
- `FiscalSubmission.fiscalDocumentId` unique.
- `FiscalSubmission.clave` unique.
- `FiscalSubmission` indexes support scope/status and due-work queries.
- F3 migration `20260914193000_fiscal_submission` is forward-only and validated on clean PostgreSQL 15.

No OAuth access tokens, refresh tokens, Hacienda passwords or raw secret values are persisted in F3 submission rows or job payloads.

## 8. APIs and integrations

Current fiscal APIs under `/api/v1` include:

| Method/path | Auth | Current behavior |
|---|---|---|
| `POST /invoices` | API key + `invoices:write` | Creates invoice fiscal snapshot ending at `READY_FOR_XML`. |
| `POST /tickets` | API key + `tickets:write` | Creates ticket fiscal snapshot ending at `READY_FOR_XML`. |
| `GET /fiscal-documents/:id` | API key + dynamic read scope | Retrieves sanitized fiscal document. |
| `POST /fiscal-documents/:id/prepare-xml` | API key + service checks | Produces signed/XSD-valid XML and reaches `READY_TO_SUBMIT`. |
| `POST /companies/:companyId/fiscal-documents/:environment/invoices/:id/submit` | API key + `invoices:write` | Requests/reuses asynchronous Hacienda submission. |
| `POST /companies/:companyId/fiscal-documents/:environment/tickets/:id/submit` | API key + `tickets:write` | Requests/reuses asynchronous Hacienda submission. |
| `GET /companies/:companyId/fiscal-documents/:environment/invoices/:id/submission` | API key + `invoices:write` | Returns sanitized invoice submission state. |
| `GET /companies/:companyId/fiscal-documents/:environment/tickets/:id/submission` | API key + `tickets:write` | Returns sanitized ticket submission state. |
| `POST /companies/:companyId/fiscal-documents/:environment/invoices/:id/submission/reconcile` | API key + `invoices:write` | Requests safe reconciliation for non-terminal invoice submission. |
| `POST /companies/:companyId/fiscal-documents/:environment/tickets/:id/submission/reconcile` | API key + `tickets:write` | Requests safe reconciliation for non-terminal ticket submission. |
| `POST /hacienda/callback` | Public provider callback | Signal-only callback endpoint; returns HTTP 200 after safe handling. |

External integration: Hacienda CE recepcion API through `HaciendaSubmissionPort` and `HaciendaRecepcionAdapter`, using official sandbox/production reception bases, bearer token, Base64 exact signed XML, status query by Clave and decoded `respuesta-xml` artifact persistence. Mock adapter supports deterministic CI/E2E.

## 9. Authentication and authorization

- Fiscal creation/read/prepare/submission APIs use API-key authentication, scopes and company authorization.
- Submission uses existing `invoices:write` / `tickets:write`; no dedicated submission scope currently exists.
- Hacienda credential access reuses `HaciendaConnection.secretReference`, `SecretProvider`, `HaciendaAuthPort`, `HaciendaOidcAuthAdapter` and `HaciendaTokenCache`.
- Tokens are cached in memory and are not persisted.
- Callback endpoint is public because Hacienda callback authenticity is not cryptographically verified by the known official contract; it is treated as a reconciliation signal only.

## 10. Events and background processing

- Fiscal audit events are recorded through `AuditService` with `EventClass.FISCAL_AUDIT` conventions.
- `JobQueuePort` supports `publish`, `schedule` and optional `registerHandler`.
- pg-boss and in-memory adapters implement handler registration.
- F3 job names include submit and reconciliation work; payloads contain identifiers only.
- Worker handles submit, reconcile, stale/unknown outcomes, retries, terminal guarded updates and due-work recovery paths according to implementation tests.

## 11. Containers and deployment

- Multi-stage `Dockerfile` builds NestJS runner image.
- Docker runner build passed in final F3 validation evidence.
- `docker-compose.yml` remains local/development oriented; production secret/default and IAM concerns remain separate deployment hardening topics.
- OQ-012 remains open before live production submission: production IAM/SecretProvider/credential availability and runtime access must be verified outside application code.

## 12. Current testing strategy

Current evidence recorded from the completed F3 implementation/audit cycle:

- `npm ci` passed.
- Prisma generate/validate/migrate deploy passed on clean PostgreSQL 15.
- `npm run lint`, `npm run lint:check`, `npm run typecheck`, unit tests, build, E2E tests and Docker build passed.
- Unit tests: 49 suites / 349 tests.
- E2E tests: 15 suites / 85 tests.
- Focused F3 tests: 13 suites / 122 tests.
- Focused F3 E2E: 14 tests.
- F3 coverage includes state machine, retry classifier, port/adapters, submit preconditions, controller routes, worker paths, callbacks, response artifact storage, audit/observability, security hardening, PostgreSQL concurrency and FE/TE continuity.

This documentation refresh did not execute commands; it records user-provided final implementation/audit evidence.

## 13. Behavior to preserve

- Modular monolith architecture and `/api/v1` prefix.
- Tenant/company/environment isolation and fail-closed authorization.
- Immutable fiscal document identity: no retry/reconcile path creates a new `FiscalDocument`, consecutive, Clave or semantically different signed XML.
- `READY_TO_SUBMIT` means local signed/XSD-ready, not Hacienda acceptance.
- Technical failures do not become fiscal `REJECTED`.
- `ACCEPTED`/`REJECTED` require authoritative Hacienda status/response.
- Ambiguous POST outcomes move to reconciliation by same Clave, not blind resubmission.
- Callback remains signal-only.
- Hacienda tokens/passwords/secrets and XML bodies are not logged or exposed by default.
- F4 PDF/email/delivery remains absent.

## 14. Known defects

| ID | Severity | Current defect/risk |
|---|---|---|
| AUD-007 / SEC-REPO-001 | High | `npm audit` reports 26 known vulnerabilities; documented as unrelated to new F3 dependencies and still unresolved. |
| OQ-012 | High before production | Production IAM/SecretProvider/credential readiness for real Hacienda submission remains a pre-production deployment concern. |
| DEF-F1-RATE-001 | High | Auth login/refresh throttling enforcement remains unproven from earlier audits. |
| AUD-002 | Medium | Concurrent duplicate `prepare-xml` calls may race; F3 submit concurrency is covered, but prepare concurrency remains a prior F2.3 hardening item. |
| AUD-003 | Medium | Expensive endpoints such as `prepare-xml` and F3 submission controller are decorated with `@SkipThrottle()` in current code paths; quota/rate policy remains to be clarified. |
| AUD-004 | Medium | Additional DB tenant/company consistency constraints for fiscal certificate/artifact/submission relations may be beneficial. |
| AUD-008 | Medium | Some path params still lack UUID validation pipes. |

No current blocking F3 functional defect is recorded after final audit; remaining items are production/dependency/hardening concerns.

## 15. Architectural debt

| ID | Severity | Debt |
|---|---|---|
| DEBT-F2.2-001 | Medium | `FiscalDocumentService` remains large and Prisma-coupled. |
| DEBT-F2.3-001 | Medium | XMLDSig/XAdES is still manually assembled behind the signing port. |
| DEBT-F2.3-002 | Medium | Prepare XML concurrency control can be hardened. |
| DEBT-F3-001 | Medium | F3 application services and workers directly use Prisma rather than a fiscal submission repository port; this is consistent with current fiscal style but less isolated than ideal hexagonal architecture. |
| DEBT-F3-002 | Medium | Worker bootstrap imports full `AppModule`; worker-only runtime boundaries are implicit. |
| DEBT-F3-003 | Low/Medium | No dedicated `fiscal-submissions:*` scopes; submission uses invoice/ticket write scopes. |

## 16. Security risks

| ID | Severity | Risk |
|---|---|---|
| SEC-REPO-001 | High | Existing npm audit vulnerabilities remain unresolved. |
| SEC-DEPLOY-001 | High | Production IAM/SecretProvider access must be verified before live Hacienda use. |
| SEC-REPO-002 | High | Docker Compose/default-secret concerns remain if reused outside local development. |
| SEC-F3-001 | Medium | Public callback cannot be cryptographically authenticated per verified contract; current mitigation is signal-only handling and authenticated reconciliation. |
| SEC-F3-002 | Medium | Submission endpoints skip throttling; abuse/cost policy should be defined before high-volume production use. |
| SEC-F2.3-002 | Medium | `prepare-xml` is computationally expensive and currently skips throttling. |
| SEC-F2.3-003 | Medium | Path params without UUID validation increase input-handling noise. |

## 17. Unknowns and assumptions

- OQ-012 remains Requires clarification before live production: exact production IAM/SecretProvider/credential provisioning and runtime access path.
- Real Hacienda sandbox/production acceptance with real taxpayer credentials is opt-in and not required for ordinary CI.
- Numeric fixed CE reception quotas are not confirmed; runtime observes provider rate-limit headers/backoff behavior.
- F4 PDF generation, email delivery and customer delivery workflow are not implemented.
- This refresh records final user-provided evidence and did not re-run commands.
