# Future Architecture

> **Synchronized:** Final F2.2/F2.3 cross-phase remediation refresh for confirmed `specs/f2-2-to-f2-3-end-to-end-fiscal-data-remediation/` by `sdd-implementation-agent-458e19` on 2026-09-13. Current remediation is complete through `READY_TO_SUBMIT`; future architecture must treat F3/Hacienda submission as separate NOT STARTED scope. Any expansion beyond supported units `Sp`/`Unid`, explicit tax metadata, and current unsupported discount/sale/payment conditionals requires a new approved specification.

> **Synchronized:** Final F2.3 architecture refresh by `hdd-architecture-agent-d7922b` on 2026-09-13 after TASK-011 and post-remediation audit. Documentation-only; no production code modified.
> This document contains target/future architecture only. Current implemented state is in `docs/current-state.md` and `docs/architecture.md`.

## 1. Vision summary

Billing should continue as an API-first modular monolith with explicit domain boundaries, stable public contracts, strong tenant/company isolation, audited fiscal workflows and replaceable infrastructure adapters.

For F2.3, the confirmed local XML preparation scope is complete and prior AUD-001 is closed. Future architecture should preserve the implemented XML/XSD/signing pipeline and only consider non-blocking hardening: stricter production verification, reducing manual XMLDSig/XAdES assembly, prepare concurrency characterization, throttling, DB consistency and dependency remediation.

## 2. Business and technical drivers

- Costa Rica Hacienda v4.4 FE/TE XML compliance.
- Legally meaningful signed XML artifacts before future submission.
- Immutable fiscal snapshots and artifact traceability.
- Secret-safe certificate handling.
- Independent verification rather than library self-trust.
- Incremental hexagonal modernization without microservices.
- Reproducible offline validation and container packaging.

## 3. Target architectural style

Target style remains a modular monolith with ports and adapters:

```text
HTTP / future worker adapters
  -> Application use cases
    -> Domain contracts, policies and value objects
    -> Output ports
      <- Prisma / Storage / SecretProvider / XSD / Signing / future Hacienda adapters
```

The signing implementation must remain replaceable behind `XmlSignerPort` so future verifier/manual-assembly hardening can be performed without rewriting `PrepareFiscalXmlService`.

## 4. Target domain map and bounded contexts

| Bounded context | Current/Future status | Target responsibility |
|---|---|---|
| Identity and Access | Implemented | Tenants, users, JWT, API keys, scopes and company authorization. |
| Company Administration | Implemented | Company fiscal identity and ownership. |
| Hacienda Integration Gateway | Implemented for public lookups | Public Hacienda lookups and future submission client boundaries. |
| Hacienda Connection | Implemented | Per-company/per-environment credentials and validation. |
| Fiscal Documents | Implemented core | Issuance points, sequences, idempotent invoice/ticket snapshots and lifecycle. |
| Fiscal XML and Signing | Implemented and accepted for F2.3 scope | Deterministic FE/TE XML, pinned XSD validation, certificate selection, TASK-011 PFX/X.509 handling, xml-crypto canonicalization/verifier evidence and artifact metadata. Future hardening may align production verification and reduce manual XMLDSig/XAdES assembly. |
| Document Artifacts | Partially implemented | Private XML/signed XML storage and metadata. |
| Fiscal Submission Processing | Future/F3 | Hacienda submission, polling, retries, callbacks/status transitions. |
| Notifications/Webhooks | Future | Customer-facing fiscal status notifications, if approved later. |

## 5. Proposed use cases and responsibilities

Near-term remediation use cases/services:

- `HardenFiscalXmlProductionVerification`: align runtime verification with stricter standards-verifier reference checks where practical.
- `ReplaceManualXadesAssembly`: optional signer adapter replacement/amendment behind `XmlSignerPort` if future maintenance risk justifies it.
- `PrepareFiscalXmlConcurrencyGuard`: prevent simultaneous duplicate transformations.
- `ApplyPrepareXmlRateLimitPolicy`: rate/quota policy for expensive XML signing/XSD validation endpoint.
- `ManageFiscalSigningCertificateRotation`: explicit future policy for active/replaced certificates and optional re-signing rules.

Existing use case to preserve:

- `PrepareFiscalXmlService`: orchestrates serialize -> store unsigned -> sign -> verify -> signed XSD -> store signed -> `READY_TO_SUBMIT`.

Future/F3 use cases remain separate:

- `SubmitFiscalDocumentToHacienda`.
- `PollFiscalDocumentStatus`.
- `HandleHaciendaResponse`.

## 6. Proposed ports and adapters

Existing ports to preserve/strengthen:

- `FiscalXmlSerializerPort` -> Hacienda v4.4 serializer adapter.
- `XsdValidatorPort` -> XSD 1.1 validation adapter.
- `XmlSignerPort` -> current or replacement XAdES signer adapter.
- `SecretProviderPort` -> certificate/password secret retrieval.
- `StoragePort` -> private XML artifact storage.

Proposed additions/clarifications:

- Optional `IndependentXmlSignatureVerifierPort` only if stricter verification becomes runtime-supported; otherwise keep standards verification as test harness evidence.
- `PrepareFiscalXmlLockPort` or repository method encapsulating row/advisory locks.
- `PrepareXmlRateLimitPolicy` using existing throttler infrastructure or a quota service.
- Fiscal persistence repository ports for F2.2/F2.3 long-term hexagonal alignment.

## 7. Proposed data ownership

Fiscal Documents/Fiscal XML should own fiscal document status, XML artifact metadata and signing certificate metadata.

Target DB hardening:

- Preserve certificate secret references only; no PFX/private key/password plaintext columns.
- Add tenant/company consistency constraints for artifacts/certificates/documents where feasible.
- Preserve signed artifact immutability after `READY_TO_SUBMIT`.
- Add lock/status mechanism only if existing constraints are insufficient for concurrent prepare safety.
- Keep JSON line snapshots unless a separate approved reporting/data decision adds relational lines.

## 8. Proposed API and integration model

- Preserve `POST /api/v1/fiscal-documents/:id/prepare-xml` as a preparation API only.
- Add deterministic UUID validation errors for path params.
- Add prepare-specific throttling/quota and document expected 429 responses.
- Keep all Hacienda submission APIs out of F2.3.
- If an independent verifier becomes runtime infrastructure, define timeout, retry/fallback, error mapping and observability.
- If independent verification remains test-only, document it as release evidence and keep production runtime unchanged.

## 9. Proposed security boundaries

- Certificate material remains in `SecretProviderPort` and never in DB plaintext.
- Test fixtures must use generated non-taxpayer certificates only.
- Private XML artifacts remain non-public by default.
- Audit/log metadata excludes XML, private keys, passwords and PFX bytes.
- Expensive signing/XSD endpoint has rate/quota protection.
- Path params are validated before service use.
- Dependency vulnerabilities are triaged and remediated or explicitly accepted.

## 10. Proposed deployment architecture

- Continue API and worker as separate processes from one monolith codebase.
- Do not add F2.3 workers unless/asynchronous preparation is separately approved.
- Package XSD helper/assets reproducibly as currently done.
- If runtime signer/verifier tooling changes, update Dockerfile and in-container validation.
- Treat Docker Compose as local-only or harden secrets before production.

## 11. Migration assumptions

- Never edit applied migrations.
- Add forward-only migrations for any DB consistency or lock changes.
- Validate migrations from zero and against representative existing data.
- Keep artifact immutability and idempotent retry tests green during migration.

## 12. Risks and trade-offs

| Risk | Trade-off / mitigation |
|---|---|
| Manual XMLDSig/XAdES assembly remains brittle | Amend or replace adapter behind `XmlSignerPort` instead of redesigning application flow. |
| Independent XAdES verification tools are heavy | Prefer test-only verifier unless runtime verification is required; document trade-off. |
| Local self-signed PFX differs from Hacienda-issued certificate | Use structurally real X.509/PFX for code evidence; consider Hacienda sandbox only in future approved scope. |
| Adding locks can reduce throughput | Lock per document only; keep retries safe. |
| Rate limiting can affect clients | Define documented quota and 429 behavior before enabling. |
| Dependency updates can regress behavior | Isolate npm audit remediation with full gates. |

## 13. Open questions

1. Should independent standards verification remain test-only or become runtime behavior?
2. What prepare endpoint rate/quota should apply per API key, company and tenant?
3. What exact certificate rotation and explicit re-signing policy should govern future operations?
4. Should F2.3 DB consistency be hardened with compound foreign keys or application/repository invariants only?
5. Should future F3 include Hacienda sandbox/receiver acceptance evidence?
