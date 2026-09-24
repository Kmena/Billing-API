# Future Architecture

> **Synchronized:** F4 Fiscal Artifacts, PDF & Delivery documentation refresh by `hdd-architecture-agent-65ee79` on 2026-09-17. Current implemented architecture is in `docs/current-state.md` and `docs/architecture.md`. F4 is now complete. This file describes target/future architecture beyond F4 only.

## 1. Vision summary

Billing should continue as an API-first modular monolith with explicit fiscal domain boundaries, strong tenant/company/environment isolation, durable fiscal workflows, replaceable infrastructure adapters and private auditable fiscal artifacts.

F4 Fiscal Artifacts, PDF & Delivery is now implemented and accepted. Future architecture should focus on:

1. **Production readiness**: OQ-012, SMTP SecretProvider migration, QR URL confirmation, 5-year retention policy.
2. **F4.1**: Rejected document replacement — the primary compliance gap.
3. **Security hardening**: dependency remediation, throttling policy, UUID validation.
4. **Maintainability**: optional repository-port extraction, prepare-XML concurrency.
5. **Future product phases**: F5 document types, possible notifications/webhooks.

## 2. Business and technical drivers

- Full production-safe electronic invoicing lifecycle: emission → Hacienda submission → PDF delivery → rejection response delivery → replacement issuance (F4.1).
- Legal compliance: Reglamento de Comprobantes Electrónicos 5-year retention, replacement issuance obligation.
- Durable evidence for compliance and customer delivery.
- Secret-safe Hacienda credential, certificate and SMTP credential handling.
- Resilient asynchronous processing under provider latency/outages/rate limits.
- Deterministic CI without live Hacienda, SMTP or PDF dependencies.
- Incremental hexagonal modernization without microservices.

## 3. Target architectural style

Target style remains a modular monolith with ports and adapters:

```text
HTTP / worker adapters
  -> Application use cases
    -> Domain contracts, policies and value objects
    -> Output ports
      <- Prisma / Storage / SecretProvider / Queue / Hacienda / Email / PDF / QR adapters
```

Microservices are not recommended unless future scale or organizational boundaries create a proven need.

## 4. Target domain map and bounded contexts

| Bounded context | Current/Future status | Target responsibility |
|---|---|---|
| Identity and Access | Implemented | Tenants, users, JWT, API keys, scopes and company authorization. |
| Company Administration | Implemented | Company fiscal identity/readiness and PDF branding settings. |
| Hacienda Public Queries | Implemented | Public taxpayer/CABYS/exchange-rate lookups. |
| Hacienda Connection | Implemented | Per-company/per-environment credentials and validation. |
| Fiscal Documents | Implemented | Issuance, immutable fiscal snapshots, lifecycle and terminal Hacienda outcome. |
| Fiscal XML and Signing | Implemented | FE/TE XML, XSD validation, signing and XML artifacts. |
| Fiscal Submission | Implemented (F3) | Hacienda submit/reconcile/callback lifecycle and response artifacts. |
| Fiscal Delivery | Implemented (F4) | Two-stage email delivery, delivery state machine, retry, manual resend and DeliveryAttempt history. |
| Fiscal Artifacts | Implemented (F4) | Unified artifact metadata, PDF generation, integrity verification and protected download. |
| Fiscal PDF and Branding | Implemented (F4) | PDFKit renderer, QR code, multi-page pagination, company branding and logo management. |
| Rejected Document Replacement / F4.1 | Future | Detect rejected comprobante, issue replacement comprobante referencing original, auto-deliver to receptor, compliance audit trail. |
| Notifications/Webhooks | Future optional | Customer/status notifications if approved. |
| F5 Document Types | Future | Support for additional Hacienda document types reusing F4 artifact/delivery infrastructure. |

## 5. Proposed use cases and responsibilities

Near-term future use cases:

- `VerifyProductionHaciendaSecretReadiness`: OQ-012 deployment readiness checklist and runbook.
- `MigrateSmtpCredentialsToSecretProvider`: route SMTP credentials through SecretProvider.
- `ConfirmHaciendaQrUrlBase`: verify and document production QR URL configuration.
- `TriageDependencyVulnerabilities`: supply-chain remediation/exception process.
- `ApplyFiscalEndpointQuotaPolicy`: throttling/quota for prepare, submit, reconcile, download and delivery endpoints.
- `ValidateUuidRouteParameters`: standardized API input validation.
- `PrepareFiscalXmlConcurrencyGuard`: harden concurrent prepare behavior.
- `OperationalizeArtifactRetentionPolicy`: 5-year storage lifecycle and retention rules.
- `IssueReplacementComprobante` (F4.1): issue a replacement FE/TE that references the rejected original and automatically delivers to receptor.
- `TrackRejectedDocumentRemediation` (F4.1): persist replacement-document reference, status and audit trail.

## 6. Proposed ports and adapters

Existing active ports to preserve:

- `XmlSignerPort`.
- `XsdValidatorPort`.
- `SecretProviderPort`.
- `StoragePort`.
- `JobQueuePort`.
- `HaciendaSubmissionPort`.
- `PdfRendererPort` (F4 — active).
- `QrContentBuilderPort` (F4 — active).
- `EmailDeliveryPort` (F4 — active).

Potential future ports:

- `FiscalSubmissionRepositoryPort` if F3 persistence complexity grows.
- `FiscalDeliveryRepositoryPort` if F4 delivery persistence complexity grows.
- `RateLimitPolicyPort` if route-level throttling needs domain-aware quotas.
- `NotificationPort` for webhook/push notifications if approved.

## 7. Proposed data ownership

- Fiscal Documents owns: document identity, snapshots, XML artifacts, submission lifecycle, Hacienda response metadata, `FiscalArtifact`, `CompanyPdfSettings`, `DocumentDelivery` and `DeliveryAttempt`.
- F4.1 should add replacement-document tracking within the same fiscal module boundary or a dedicated submodule; must reference original rejected `FiscalDocument` by ID.
- Future delivery tables should belong to Fiscal Delivery context; reference fiscal documents by ID only.
- Do not store Hacienda tokens, passwords, private keys, SMTP passwords or raw secrets in delivery/submission tables.
- Add forward-only migrations only; never edit applied migrations.
- 5-year retention obligation: no destructive purge of fiscal artifact rows without explicit approval.

## 8. Proposed API and integration model

Future API areas to specify before implementation:

- F4.1: replacement comprobante issuance and tracking APIs.
- Dedicated fiscal-submission, fiscal-artifact and fiscal-delivery scopes (if least-privilege policy approved).
- Documented 429 behavior for all expensive fiscal endpoints.
- Signed-URL download pattern (if approved over authenticated streaming MVP).
- Optional webhook/notification API for delivery events.
- F5 document type endpoints reusing F4 artifact/delivery infrastructure.

Future integrations:

- SMTP credentials behind `SecretProvider` (near-term prerequisite).
- Optional: object-storage signed URL for PDF/XML access (if approved).
- Optional: webhook delivery adapter behind `NotificationPort`.

## 9. Proposed security boundaries

- Keep XML, response XML, PDF artifacts and logo files private by default.
- Route SMTP credentials through `SecretProvider` before production email delivery.
- Verify `HACIENDA_QR_URL_BASE` in production configuration before deployment.
- Add quota/rate protection for all expensive fiscal endpoints.
- Standardize UUID/path validation.
- Remediate or formally accept dependency vulnerabilities.
- Verify production SecretProvider/IAM before live Hacienda use.
- F4.1 replacement comprobante must maintain same integrity standards as original: immutable Clave, consecutive, signed XML.

## 10. Proposed deployment architecture

- Keep API and worker as separate processes from the same monolith codebase.
- Add production runbooks for: Hacienda credentials, SMTP credentials, callback URL exposure, QR URL, queue workers, reconciliation monitoring, delivery retry monitoring and 5-year retention policy.
- Keep live Hacienda sandbox/production, SMTP and real PDF renderer opt-in and secret-backed.
- Treat Docker Compose as local-only unless separately hardened.
- 5-year retention: configure storage provider lifecycle rules to prevent deletion of fiscal artifact objects.

## 11. Migration assumptions

- Use forward-only migrations.
- Validate from-zero migration deploy and representative upgrade paths on PostgreSQL 15.
- Preserve existing F3/F4 rows during F4.1 migrations.
- F4.1 backfill of replacement-document references only if explicitly approved and scoped.
- No destructive purge of fiscal artifacts without explicit retention-policy approval.

## 12. Risks and trade-offs

| Risk | Trade-off / mitigation |
|---|---|
| F4.1 compliance gap — rejected document replacement | Block unattended production issuance until F4.1 is implemented; manual operator remediation documented for interim. |
| SMTP credentials in plain env vars | Migrate to SecretProvider before production deployment; block production EMAIL_USE_REAL until complete. |
| HACIENDA_QR_URL_BASE exact URL not confirmed | Config fails fast in production/staging; confirm URL and document in runbook before deployment. |
| 5-year retention not operationalized | Define storage lifecycle rules before any production fiscal documents are created. |
| Dependency remediation regresses behavior | Isolate supply-chain workstream and run full quality gates. |
| Route throttling blocks legitimate batch issuance | Define tenant/API-key quotas and operational override before implementation. |
| Repository-port extraction causes churn | Defer until behavior is stable and complexity justifies extraction. |
| Live Hacienda credentials unavailable | Keep CI mock-only; block production submission until OQ-012 passes. |
| PDF renderer version drift | Template/renderer version stored in FiscalArtifact; historical PDFs remain immutable even if renderer upgrades. |
| F5 document types reuse | F4 delivery/artifact infrastructure designed for extensibility (NFR-005); no redesign expected for additional document types. |

## 13. Open questions

1. What production IAM/SecretProvider process satisfies OQ-012?
2. Should fiscal submission/delivery/artifact operations have dedicated API-key scopes?
3. What quota/rate policy applies to prepare, submit, reconcile, download and delivery endpoints?
4. What is the F4.1 replacement-document issuance workflow (immediate auto-issuance vs. operator-initiated)?
5. What is the approved storage lifecycle/retention provider configuration for 5-year obligation?
6. Should `PDF_RENDERER` selection use a dedicated `USE_REAL_PDF` flag for symmetry with `USE_REAL_HACIENDA`?
7. Should signed-URL artifact download be approved as an alternative to the current authenticated-streaming MVP?
8. Which F5 document types are next, and do they require new XML schemas or delivery adaptations?
