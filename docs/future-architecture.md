# Future Architecture

> **Synchronized:** Final architecture documentation refresh for canonical `specs/post-f2-2-remediation` by `hdd-architecture-agent-7fd8b9` on 2026-09-12. Documentation-only change; no production code, tests or Prisma migrations modified.
> This document describes proposed future-state architecture only. For implemented architecture, see `docs/architecture.md`; for staged work, see `docs/action-plan.md` and `docs/tasks.md`.
> Post-F2.2 remediation is complete; F2.3 XML/XSD/XAdES remains not started.

---

## 1. Vision summary

Billing should continue evolving as an API-first modular monolith for Costa Rica electronic invoicing, with explicit domain boundaries, stable public contracts, strong tenant isolation, audited fiscal workflows and asynchronous processing only where document generation/submission requires it.

F2.2 fiscal document core is now implemented as a local persistence/core workflow ending at `READY_FOR_XML`. Future architecture should build on that baseline rather than replacing it wholesale.

---

## 2. Business and technical drivers

- Costa Rica Ministerio de Hacienda v4.4 compliance.
- Stable integration APIs for external clients.
- Immutable fiscal snapshots suitable for later XML generation.
- Strict tenant/company/API-key authorization boundaries.
- Fiscal auditability and long-term traceability.
- Reliable sequence allocation and idempotent creation.
- Incremental modernization toward stricter hexagonal boundaries.
- Avoid microservices until operational evidence justifies decomposition.

---

## 3. Target architectural style

Target style remains a modular monolith with stricter ports-and-adapters boundaries over time:

```text
HTTP/Worker adapters
  -> Application input ports / use cases
    -> Domain entities, value objects, policies and events
    -> Output ports
      <- Prisma/Hacienda/Storage/Queue/Signing adapters
```

Future fiscal code should avoid direct Prisma usage in application use cases once persistence ports/adapters are extracted. Controllers should return explicit DTOs instead of ORM records.

---

## 4. Target domain map and bounded contexts

| Bounded context | Current/Future status | Target responsibility |
|---|---|---|
| Identity and Access | Implemented | Tenants, users, JWT, API keys, scopes and company authorization. |
| Company Administration | Implemented | Company fiscal identity and ownership. |
| Hacienda Integration Gateway | Implemented | Public Hacienda lookups, resilience, mock/live adapters. |
| Hacienda Connection | Implemented | Per-company/per-environment credentials and validation. |
| Fiscal Documents | Implemented core; needs hardening | Fiscal issuance points, sequences, idempotent invoice/ticket creation, immutable snapshots, response contracts. |
| Fiscal XML and Signing | Future | XML generation, XSD validation and XAdES signing from immutable fiscal document data. |
| Fiscal Submission Processing | Future | Queue jobs, Hacienda submission, polling, status transitions, retries and recovery. |
| Document Artifacts | Future | XML/signed XML/Hacienda response storage; optional PDF later. |
| Webhooks/Notifications | Future | Status notifications, retries, signatures and auditability. |

---

## 5. Proposed use cases and responsibilities

Near-term future use cases:

- `CreateFiscalDocumentUseCase`: behavior-preserving extraction from current service.
- `GetFiscalDocumentUseCase`: retrieval with dynamic type-specific read authorization.
- `ConfigureDefaultIssuancePointUseCase`: JWT-only management of default issuance point.
- `ConfigureFiscalSequenceUseCase`: JWT-only sequence start configuration and already-started rejection.
- `MapFiscalDocumentResponse`: formal explicit response DTO mapping that preserves current omission of `securityCode` and `requestHash`.
- `ValidateFiscalDocumentForXmlReadiness`: expanded v4.4 validations before XML phase.

Later fiscal processing use cases:

- `GenerateFiscalXmlFromDocument`.
- `SignFiscalXml`.
- `SubmitFiscalDocumentToHacienda`.
- `PollFiscalDocumentStatus`.
- `StoreFiscalArtifact`.
- `PublishFiscalStatusNotification`.

---

## 6. Proposed ports and adapters

Recommended future fiscal ports:

- `FiscalDocumentRepositoryPort` -> Prisma adapter.
- `FiscalIssuancePointRepositoryPort` -> Prisma adapter.
- `FiscalSequenceRepositoryPort` -> Prisma adapter with atomic SQL allocation encapsulated.
- `FiscalIdempotencyRepositoryPort` -> Prisma adapter.
- `FiscalAuthorizationPort/Service` -> API-key/company and management policy checks.
- `FiscalXmlGeneratorPort` -> future XML adapter.
- `XmlSignerPort` -> future signing adapter; currently only a stub exists under infrastructure.
- `FiscalSubmissionPort` -> future Hacienda reception adapter.
- `FiscalArtifactStoragePort` -> existing `StoragePort` integration for XML/artifacts.
- `FiscalJobQueuePort` -> existing `JobQueuePort` integration for submission/polling jobs.

---

## 7. Proposed data ownership

Fiscal Documents should own fiscal issuance points, sequences, idempotency records, fiscal documents and any future fiscal line/artifact metadata.

Future database decisions requiring approval:

- Whether to keep fiscal lines as JSON snapshots or add relational `fiscal_document_lines`.
- Preserve the implemented idempotency actor/API-key/operation scope added by migration `20260911143000_fiscal_idempotency_scope`.
- Whether to add a partial unique index for active default issuance points.
- Preserve the implemented Post-F2.2 fiscal consecutive scope `(tenant_id, company_id, environment, consecutive)`; do not reintroduce globally unique `consecutive`.

All database changes must be forward-only migrations.

---

## 8. Proposed API and integration model

Future public fiscal APIs should expose explicit DTO contracts, not raw Prisma records.

Recommended contract principles:

- Expose `clave` and `consecutive`.
- Continue not exposing standalone `securityCode` or `requestHash` in fiscal document responses.
- Return immutable snapshots and calculated totals in normalized DTO format.
- Keep XML/signing/submission APIs separate from local `READY_FOR_XML` creation.
- Maintain type-specific scopes for invoice/ticket operations.
- Version public contract if breaking response changes become unavoidable.

---

## 9. Proposed security boundaries

- API-key fiscal creation/read remains type-scope and company-authorized.
- JWT-only TENANT_ADMIN fiscal configuration remains separate from API-key endpoints.
- Fiscal response DTOs should hide sensitive/internal fields.
- Audit events remain categorical and exclude credentials, tokens, full payloads and security codes.
- Future signing credentials must use `SecretProviderPort`; never persist or log plaintext credentials.
- Future Hacienda submission jobs must preserve tenant/company boundaries.

---

## 10. Proposed deployment architecture

- Continue API and worker as separate processes from one monolith codebase.
- Use worker for future XML/submission/polling jobs when asynchronous behavior is introduced.
- Keep PostgreSQL as source of truth and queue backend unless scaling evidence requires change.
- Harden Docker Compose/default secrets or document Compose as local-only before production use.
- Continue CI gates for Prisma validate/generate/migrate, lint, typecheck, tests and build.

---

## 11. Migration assumptions

- F2.2 migration may already be applied; never edit it.
- Future fiscal database changes use new forward-only migrations.
- Before refactoring fiscal service, add fiscal E2E/API characterization tests.
- Before XML generation, confirm fiscal line persistence and response DTO decisions.
- Before Hacienda submission, implement signing adapter selection and job/retry strategy.

---

## 12. Risks and trade-offs

| Risk | Trade-off / mitigation |
|---|---|
| Current compact fiscal service diverges from strict hexagonal target | Add tests first, then extract use cases and ports incrementally. |
| Response sanitizer lacks formal DTO contract | Introduce DTO mappers and security-focused response tests to preserve omission of `securityCode`/`requestHash`. |
| JSON fiscal lines may limit reporting/XML querying | Decide before XML/reporting phase; add relational table only if justified. |
| Future signing/submission complexity | Keep separate bounded responsibilities and asynchronous worker path. |
| Docker/npm audit concerns | Treat as separate high-priority platform hardening tasks. |

---

## 13. Open questions

1. Should standalone `securityCode` remain persistence-only permanently, including for future admin/internal APIs?
2. Is JSON line persistence accepted for near-term XML generation, or should relational lines be introduced first?
3. Which XAdES signing library/adapter will be approved for future phases?
4. What is the desired production deployment model beyond local Docker Compose?
