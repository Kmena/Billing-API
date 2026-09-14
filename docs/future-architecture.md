# Future Architecture

> **Synchronized:** Final F3 Hacienda asynchronous submission documentation refresh by `hdd-architecture-agent-4f9f0f` on 2026-09-14. Current implemented architecture is in `docs/current-state.md` and `docs/architecture.md`. This file contains target/future architecture only.

## 1. Vision summary

Billing should continue as an API-first modular monolith with explicit fiscal domain boundaries, strong tenant/company/environment isolation, durable fiscal workflows, replaceable infrastructure adapters and private auditable fiscal artifacts.

F3 Hacienda asynchronous submission is now implemented and accepted for the confirmed scope. Future architecture should focus on production readiness, security hardening, maintainability improvements and the next product phase: F4 PDF/email/delivery.

## 2. Business and technical drivers

- Production-safe electronic invoicing lifecycle after Hacienda acceptance/rejection.
- Durable evidence for compliance and customer delivery.
- Secret-safe Hacienda credential and certificate handling.
- Resilient asynchronous processing under provider latency/outages/rate limits.
- Deterministic CI without live Hacienda dependencies.
- Incremental hexagonal modernization without microservices.

## 3. Target architectural style

Target style remains a modular monolith with ports and adapters:

```text
HTTP / worker adapters
  -> Application use cases
    -> Domain contracts, policies and value objects
    -> Output ports
      <- Prisma / Storage / SecretProvider / Queue / Hacienda / Email/PDF adapters
```

Microservices are not recommended unless future scale or organizational boundaries create a proven need.

## 4. Target domain map and bounded contexts

| Bounded context | Current/Future status | Target responsibility |
|---|---|---|
| Identity and Access | Implemented | Tenants, users, JWT, API keys, scopes and company authorization. |
| Company Administration | Implemented | Company fiscal identity/readiness and ownership. |
| Hacienda Public Queries | Implemented | Public taxpayer/CABYS/exchange-rate lookups. |
| Hacienda Connection | Implemented | Per-company/per-environment credentials and validation. |
| Fiscal Documents | Implemented | Issuance, immutable fiscal snapshots, lifecycle and terminal Hacienda outcome. |
| Fiscal XML and Signing | Implemented | FE/TE XML, XSD validation, signing and XML artifacts. |
| Fiscal Submission Processing | Implemented in F3 | Hacienda submit/reconcile/callback lifecycle and response artifacts. |
| Fiscal Delivery / F4 | Future | PDF generation, email/customer delivery, delivery audit, delivery retries and customer-facing artifact access. |
| Notifications/Webhooks | Future optional | Customer/status notifications if approved. |

## 5. Proposed use cases and responsibilities

Near-term future use cases:

- `VerifyProductionHaciendaSecretReadiness`: OQ-012 deployment readiness checklist and runbook.
- `TriageDependencyVulnerabilities`: supply-chain remediation/exception process.
- `ApplyFiscalEndpointQuotaPolicy`: throttling/quota for prepare, submit and reconcile.
- `ValidateUuidRouteParameters`: standardized API input validation.
- `PrepareFiscalXmlConcurrencyGuard`: harden concurrent prepare behavior.
- `GenerateFiscalPdf`: future F4 PDF from immutable fiscal document + XML + Hacienda response.
- `DeliverFiscalDocumentEmail`: future F4 email/delivery workflow with retry/audit.

## 6. Proposed ports and adapters

Existing ports to preserve:

- `XmlSignerPort`.
- `XsdValidatorPort`.
- `SecretProviderPort`.
- `StoragePort`.
- `JobQueuePort`.
- `HaciendaSubmissionPort`.

Potential future ports:

- `FiscalSubmissionRepositoryPort` if F3 persistence complexity grows.
- `PdfRendererPort` for F4 PDF generation.
- `EmailDeliveryPort` for F4 email provider abstraction.
- `DeliveryAuditPort` or use existing audit conventions if sufficient.
- `RateLimitPolicyPort` if route-level throttling needs domain-aware quotas.

## 7. Proposed data ownership

- Fiscal Documents owns document identity, snapshots, XML artifacts, submission lifecycle and Hacienda response metadata.
- F4 should not mutate fiscal issuance identity or signed XML; it should reference immutable artifacts and terminal response evidence.
- Future delivery tables should belong to a Fiscal Delivery context or submodule and reference fiscal documents/submissions by ID.
- Do not store Hacienda tokens, passwords, private keys or raw secrets in delivery/submission tables.
- Add forward-only migrations only; never edit applied migrations.

## 8. Proposed API and integration model

Future API areas to specify before implementation:

- F4 PDF retrieval/generation APIs.
- Email delivery request/status APIs.
- Customer delivery audit/status retrieval.
- Optional webhook/notification API.
- Dedicated fiscal-submission scopes if least-privilege policy changes.
- Documented 429 behavior for expensive fiscal endpoints.

Future integrations:

- PDF renderer behind a port.
- Email provider behind a port with retries, idempotency and bounce/error mapping.
- Optional object-storage signed URL policy for PDF/XML access.

## 9. Proposed security boundaries

- Keep XML, response XML and future PDF artifacts private by default.
- Use short-lived signed URLs only if approved and audited.
- Redact PII/secrets from logs and delivery errors.
- Verify production SecretProvider/IAM before live Hacienda use.
- Remediate or formally accept dependency vulnerabilities.
- Add quota/rate protection for expensive fiscal endpoints.
- Standardize UUID/path validation.

## 10. Proposed deployment architecture

- Keep API and worker as separate processes from the same monolith codebase.
- Add production runbooks for Hacienda credentials, callback URL exposure, queue workers and reconciliation monitoring.
- Keep live Hacienda sandbox/production checks opt-in and secret-backed.
- Treat Docker Compose as local-only unless separately hardened.

## 11. Migration assumptions

- Use forward-only migrations.
- Validate from-zero migration deploy and representative upgrade paths.
- Preserve existing `FiscalSubmission` rows and response artifact references during F4 migrations.
- Backfill delivery records only if a future approved F4 requirement explicitly requires it.

## 12. Risks and trade-offs

| Risk | Trade-off / mitigation |
|---|---|
| F4 exposes sensitive fiscal artifacts | Private-by-default storage, explicit access policy, audit every access. |
| Dependency remediation regresses behavior | Isolate supply-chain workstream and run full gates. |
| Route throttling blocks legitimate batch issuance | Define tenant/API-key quotas and operational override before implementation. |
| Repository-port extraction causes churn | Defer until behavior is stable and complexity justifies extraction. |
| Live Hacienda credentials unavailable | Keep CI mock-only and block production submission until OQ-012 passes. |

## 13. Open questions

1. What production IAM/SecretProvider process satisfies OQ-012?
2. Should fiscal submission have dedicated API-key scopes?
3. What quota/rate policy applies to prepare, submit and reconcile?
4. What F4 artifact access model is acceptable for customers/operators?
5. Which email provider and delivery retry/audit requirements should F4 use?
