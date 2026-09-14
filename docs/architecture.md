# Architecture

> **Synchronized:** Final F3 Hacienda asynchronous submission documentation refresh by `hdd-architecture-agent-4f9f0f` on 2026-09-14 for confirmed `specs/fase-3-hacienda-async-submission`. Documentation-only refresh; no production code, tests, Prisma schema or migrations changed by this agent.
>
> This document describes only architecture currently implemented or actively governing the system. Future remediation belongs in `docs/action-plan.md` and `docs/tasks.md`.

## 1. Purpose and scope

This document records the active architecture of Billing after the completed F3 Hacienda asynchronous submission implementation. F3 is functionally complete for READY_TO_SUBMIT FE/TE asynchronous submission, authoritative acceptance/rejection, response artifact persistence, callback-signal handling and worker-based reconciliation. Final audit verdict: **Acceptable 8.6/10**.

Out of scope for this active-architecture document: target redesigns, F4 PDF/email/delivery, microservice decomposition, live production IAM/SecretProvider approval and dependency remediation.

## 2. Current active architecture summary

Billing is an API-first modular monolith using NestJS, TypeScript, Prisma and PostgreSQL.

Runtime entrypoints:

- API process: `src/bootstrap/api.main.ts`.
- Worker process: `src/bootstrap/worker.main.ts`.

Active fiscal flow now spans:

```text
FE/TE creation -> READY_FOR_XML
  -> prepare XML/sign/XSD -> READY_TO_SUBMIT
  -> request Hacienda submission -> FiscalSubmission queued
  -> worker submit/reconcile through HaciendaSubmissionPort
  -> authoritative ACCEPTED or REJECTED + response artifact
```

F3 adds a dedicated submission submodule inside `src/modules/fiscal-documents`:

```text
FiscalSubmissionController / HaciendaCallbackController
  -> SubmitFiscalDocumentService
  -> GetFiscalSubmissionStatusService
  -> RequestFiscalSubmissionReconciliationService
  -> HandleHaciendaCallbackService
  -> FiscalSubmissionWorkerService
    -> FiscalSubmissionStateMachine
    -> RetryClassifier
    -> Prisma
    -> JobQueuePort
    -> StoragePort
    -> Hacienda auth/connection/token cache/secret provider
    -> HaciendaSubmissionPort
      <- HaciendaRecepcionAdapter | MockHaciendaSubmissionAdapter
```

## 3. Active architectural style and module boundaries

Active style remains a modular monolith with incremental hexagonal/ports-and-adapters boundaries.

Current fiscal boundaries:

- Fiscal document creation/read and some orchestration remain Prisma-backed application services.
- Fiscal XML uses explicit ports for serializer, XSD validation, signing, secrets and storage.
- Fiscal submission uses domain helpers for state/retry policy, application services/workers for orchestration, a provider port for Hacienda recepcion, queue and storage ports for infrastructure, and Prisma for persistence.
- Hacienda provider Spanish DTO fields are contained in the infrastructure adapter; application-facing port/result objects use domain/application language.

## 4. Current domain map

| Domain / Module | Classification | Responsibility | Code location |
|---|---|---|---|
| Identity and Access | Core-supporting | Tenants, users, JWT, refresh tokens, API keys, scopes and company authorization. | `src/modules/identity`, `src/modules/api-keys` |
| Company Administration | Core | Company identity, ownership and fiscal profile/readiness data. | `src/modules/companies` |
| Hacienda Public Queries | Supporting | Taxpayer, CABYS and exchange-rate lookups. | `src/modules/taxpayers`, `src/modules/cabys`, `src/modules/exchange-rates` |
| Hacienda Connection | Core-enabling | Per-company/per-environment credentials, validation, OAuth/OIDC auth and token cache. | `src/modules/hacienda-connection` |
| Fiscal Documents | Core | Issuance, sequences, immutable fiscal snapshots, XML readiness and document-level terminal Hacienda outcome. | `src/modules/fiscal-documents` |
| Fiscal XML and Signing | Core-supporting | Generate Hacienda v4.4 FE/TE XML, validate XSD, sign/verify and manage XML artifacts. | `src/modules/fiscal-documents/**/fiscal-xml`, `src/infrastructure/signing` |
| Fiscal Submission | Core-supporting | Asynchronous Hacienda submission, retry/reconciliation lifecycle, callbacks and response artifact metadata. | `src/modules/fiscal-documents/**/submission` |
| Audit | Generic-supporting | Audit event recording. | `src/modules/audit` |
| Cross-cutting Infrastructure | Generic | Config, database, queues, secrets, storage, tenant context and adapters. | `src/infrastructure` |

## 5. Current runtime components and responsibilities

| Component | Responsibility |
|---|---|
| `AppModule` | Registers infrastructure and business modules, including fiscal documents, Hacienda connection and signing/submission infrastructure. |
| `FiscalDocumentService` | Fiscal FE/TE creation/read/configuration orchestration and immutable snapshot persistence. |
| `PrepareFiscalXmlService` | Generates, signs, verifies, XSD-validates and stores FE/TE XML; transitions to `READY_TO_SUBMIT`. |
| `SubmitFiscalDocumentService` | Validates preconditions, creates/reuses `FiscalSubmission`, enqueues submit/reconcile work and returns sanitized state. |
| `GetFiscalSubmissionStatusService` | Returns tenant/company/environment-scoped sanitized submission state. |
| `RequestFiscalSubmissionReconciliationService` | Enqueues safe reconciliation for non-terminal submissions. |
| `HandleHaciendaCallbackService` | Treats callback body as signal-only and queues reconciliation by trusted persisted Clave mapping. |
| `FiscalSubmissionWorkerService` | Registers submit/reconcile handlers and performs provider calls, token reuse, result classification, state persistence and response artifact storage. |
| `FiscalSubmissionStateMachine` | Enforces allowed transitions and terminal non-regression. |
| `RetryClassifier` | Maps provider/technical outcomes into retry, reconcile, terminal or manual-review decisions. |
| `HaciendaSubmissionPort` | Application-facing provider boundary for submit/status query. |
| `HaciendaRecepcionAdapter` | Real Hacienda CE `POST /recepcion` and `GET /recepcion/{clave}` HTTP adapter. |
| `MockHaciendaSubmissionAdapter` | Deterministic fake adapter for CI/unit/E2E without live Hacienda. |
| `JobQueuePort` | Publishes/schedules jobs and optionally registers handlers. |
| `StoragePort` | Stores private XML and Hacienda response artifacts. |
| `AuditService` | Records fiscal lifecycle events without secrets/tokens/XML bodies. |

## 6. Current dependency rules

Active intended dependency direction:

```text
Input adapter -> Application service/use case -> Domain helper/policy -> Output port <- Output adapter
```

Current deviations/limitations:

| ID | Severity | Location | Rule affected | Current impact | Recommended target |
|---|---|---|---|---|---|
| ARCH-F2.2-001 | Medium | `FiscalDocumentService` | Application should depend on output ports rather than concrete Prisma infrastructure. | Fiscal creation remains harder to unit-test/refactor. | Extract repository/idempotency/sequence ports incrementally. |
| ARCH-F2.3-002 / AUD-002 | Medium | `PrepareFiscalXmlService` | Transformation use case should enforce concurrency/idempotency boundaries. | Simultaneous duplicate prepare requests may race. | Add DB lock/status transition guard and concurrency E2E. |
| ARCH-F2.3-003 / AUD-003 | Medium | `FiscalXmlController`, `FiscalSubmissionController` | Expensive endpoints should be throttled/limited. | Current controllers skip throttling. | Define/enforce API-key quota/rate policy. |
| ARCH-F3-001 | Medium | F3 application services/workers | Application services should ideally use output repository ports. | F3 directly uses Prisma, consistent with existing fiscal style but not fully hexagonal. | Extract `FiscalSubmissionRepositoryPort` only if future complexity justifies it. |
| ARCH-F3-002 | Medium | Worker runtime | Worker process imports full `AppModule`. | Runtime boundaries are implicit. | Consider worker-specific module composition if API-only side effects appear. |
| ARCH-F1-001 | High | Auth throttling | Security guard enforcement should be proven. | Login/refresh rate limiting remains unproven from earlier audit. | Add threshold tests/fix through separate approved task. |

Positive boundaries:

- F3 domain state machine and retry classifier do not depend on NestJS, Prisma or HTTP clients.
- Hacienda HTTP details are isolated behind `HaciendaSubmissionPort` and adapters.
- Secrets/tokens are not public contracts and are not persisted.

## 7. Current database ownership and transaction boundaries

Fiscal Documents owns:

- `fiscal_issuance_points`
- `fiscal_sequences`
- `fiscal_documents`
- `fiscal_idempotency_keys`
- `fiscal_signing_certificates`
- `fiscal_xml_artifacts`
- `fiscal_submissions`

Current transaction/integrity boundaries:

- F2.2 creation wraps idempotency reservation, sequence allocation and document persistence in one Prisma transaction.
- F2.3 prepare persists XML artifact/status transitions; simultaneous prepare hardening remains future work.
- F3 uses a dedicated `FiscalSubmission` consistency boundary with unique `fiscalDocumentId` and unique `clave`, guarded terminal transitions and optimistic `version` metadata.
- Authoritative terminal F3 transitions update both `FiscalSubmission.status` and `FiscalDocument.status` to `ACCEPTED` or `REJECTED`.
- Existing `READY_TO_SUBMIT` rows are eligible lazily; migration does not fabricate prior submission history.

Current migrations include forward-only migration `20260914193000_fiscal_submission`, validated from zero on PostgreSQL 15 during final F3 gates.

## 8. Current API and integration contracts

All paths are under `/api/v1`.

| API | Auth | Contract summary |
|---|---|---|
| `POST /invoices` | API key + `invoices:write` | Creates invoice fiscal snapshot; status `READY_FOR_XML`. |
| `POST /tickets` | API key + `tickets:write` | Creates ticket fiscal snapshot; status `READY_FOR_XML`. |
| `GET /fiscal-documents/:id` | API key + dynamic read scope | Returns sanitized fiscal document. |
| `POST /fiscal-documents/:id/prepare-xml` | API key + service checks | Returns XML preparation metadata; reaches `READY_TO_SUBMIT`. |
| `POST /companies/:companyId/fiscal-documents/:environment/invoices/:id/submit` | API key + `invoices:write` | Creates/reuses invoice submission and queues work; HTTP 202. |
| `POST /companies/:companyId/fiscal-documents/:environment/tickets/:id/submit` | API key + `tickets:write` | Creates/reuses ticket submission and queues work; HTTP 202. |
| `GET /companies/:companyId/fiscal-documents/:environment/invoices/:id/submission` | API key + `invoices:write` | Returns sanitized invoice submission state. |
| `GET /companies/:companyId/fiscal-documents/:environment/tickets/:id/submission` | API key + `tickets:write` | Returns sanitized ticket submission state. |
| `POST /companies/:companyId/fiscal-documents/:environment/invoices/:id/submission/reconcile` | API key + `invoices:write` | Queues safe invoice reconciliation; HTTP 202. |
| `POST /companies/:companyId/fiscal-documents/:environment/tickets/:id/submission/reconcile` | API key + `tickets:write` | Queues safe ticket reconciliation; HTTP 202. |
| `POST /hacienda/callback` | Public provider callback | Signal-only reconciliation trigger; does not trust callback for tenant/company/terminal truth. |

Hacienda integration contract:

- Production base: `https://api.comprobanteselectronicos.go.cr/recepcion/v1/`.
- Sandbox base: `https://api.comprobanteselectronicos.go.cr/recepcion-sandbox/v1/`.
- Auth: bearer token from existing Hacienda OIDC/auth components.
- Submit: `POST /recepcion`, exact signed XML UTF-8 bytes Base64 encoded as `comprobanteXml`.
- HTTP 201 means acknowledged/pending, not accepted.
- Status: `GET /recepcion/{clave}` maps `recibido`/`procesando` to non-terminal and `aceptado`/`rechazado` to authoritative terminal outcomes.
- `respuesta-xml` is Base64 decoded and stored as exact private response artifact.

## 9. Current security boundaries

- Tenant/company/environment scoping is enforced on fiscal submission APIs and persistence lookups.
- F3 submit/status/reconcile use existing invoice/ticket write scopes.
- Provider callbacks are public but signal-only; terminal outcomes require trusted persisted Clave/submission mapping and reconciliation logic.
- Hacienda credentials remain behind `SecretProvider`; tokens are in-memory only.
- Job payloads contain identifiers only, not tokens/passwords/XML bodies.
- XML and Hacienda response artifacts are private storage objects; APIs expose metadata, not raw secrets.
- Known unresolved security risks: npm audit vulnerabilities, production IAM/SecretProvider readiness, default-secret/compose caution, throttling policy and UUID validation.

## 10. Current container and deployment architecture

- Multi-stage `Dockerfile` builds the NestJS app and runner image.
- Docker runner build passed in final F3 validation evidence.
- `docker-compose.yml` remains local/development oriented.
- F3 production deployment requires separate verification of OQ-012: IAM/SecretProvider access, real credential availability and operational secret policy.

## 11. Current testing strategy

Current strategy includes unit, application, adapter, PostgreSQL-backed concurrency, E2E, migration and Docker validation.

Final F3 evidence supplied:

- `npm ci` passed.
- Prisma generate/validate/migrate deploy passed on clean PostgreSQL 15.
- lint, lint:check, typecheck, unit, build, E2E and Docker build passed.
- Unit: 49 suites / 349 tests.
- E2E: 15 suites / 85 tests.
- Focused F3: 13 suites / 122 tests.
- Focused F3 E2E: 14 tests.

This documentation refresh did not execute commands.

## 12. Active architectural decisions

| Decision | Current status |
|---|---|
| Use modular monolith, not microservices. | Active. |
| Use NestJS + TypeScript + Prisma + PostgreSQL. | Active. |
| Keep global HTTP prefix `/api/v1`. | Active. |
| Keep F2.2/F2.3 immutable artifact boundary: F3 never regenerates fiscal document, consecutive, Clave or signed XML. | Active. |
| Use dedicated `FiscalSubmission` for F3 technical/provider lifecycle. | Active. |
| Add only authoritative `ACCEPTED`/`REJECTED` to `FiscalDocumentStatus`; keep intermediate provider/job states in `FiscalSubmissionStatus`. | Active. |
| Use existing pg-boss/`JobQueuePort` instead of a new broker. | Active. |
| Use `HaciendaSubmissionPort` for provider submission/status boundary. | Active. |
| Treat HTTP 201 from Hacienda submit as acknowledgement/pending, not acceptance. | Active. |
| Treat callback as signal-only because no callback-specific cryptographic authentication is verified. | Active. |
| Reuse Hacienda connection/auth/token-cache/SecretProvider components; do not persist OAuth tokens/passwords. | Active. |
| CI/E2E uses deterministic mock Hacienda; live sandbox is opt-in only. | Active. |
| F4 PDF/email/delivery is not part of current implementation. | Active. |

## 13. Known architectural limitations

- F2.2/F3 application services directly use Prisma; repository ports are not consistently extracted.
- Worker process uses full `AppModule` instead of a minimized worker module.
- No dedicated submission scopes exist; current write scopes authorize submission/status/reconcile operations.
- `@SkipThrottle()` remains on expensive fiscal controllers; rate/quota policy needs approval.
- Prepare XML concurrent duplicate processing remains a prior hardening item.
- XMLDSig/XAdES remains manually assembled behind a port.
- Production IAM/SecretProvider readiness is not proven in repo-level code/tests.
- npm audit vulnerabilities remain unresolved.
- F4 PDF/email/delivery is absent.

## 14. Open decisions requiring clarification

1. What exact production IAM/SecretProvider provisioning and runtime access model satisfies OQ-012 before live Hacienda use?
2. Should fiscal submission get dedicated scopes such as `fiscal-submissions:write/read/reconcile`, or continue using invoice/ticket write scopes?
3. What throttle/quota policy should apply to `prepare-xml`, submit and reconcile endpoints?
4. Should UUID validation be implemented globally or per fiscal controller?
5. Should `FiscalSubmissionRepositoryPort` be extracted now or deferred until F3 grows further?
6. What is the approved F4 contract for response artifact consumption, PDF generation, email delivery and delivery audit?
