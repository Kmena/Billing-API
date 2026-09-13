# Architecture

> **Synchronized:** Final F2.2/F2.3 cross-phase remediation refresh for confirmed `specs/f2-2-to-f2-3-end-to-end-fiscal-data-remediation/` by `sdd-implementation-agent-458e19` on 2026-09-13 with `hdd-architecture-agent` guidance. TASK-001 through TASK-022 are complete. Final audit PASS with non-blocking concerns, score **8.8/10**. Implemented boundary is `READY_TO_SUBMIT`; F3/Hacienda submission remains **NOT STARTED**.
>
> **Active boundary update:** `CompanyFiscalProfile` owns issuer fiscal readiness data including structured address and `proveedorSistemas`. `FiscalDocumentService` owns FE/TE creation, fiscal readiness validation and immutable snapshotting before `READY_FOR_XML`. The immutable snapshot is the F2.2 -> F2.3 boundary. F2.3 transforms/signs/validates from that snapshot only and must not infer or fabricate missing fiscal business data.

> **Synchronized:** Final architecture documentation refresh for confirmed `specs/fase-2-3-fiscal-xml-signing/` by `hdd-architecture-agent-d7922b` on 2026-09-13 after TASK-011 and post-remediation audit. Documentation-only refresh; no production code, tests, Prisma schema or migrations modified.
> This document describes only the architecture currently implemented or actively governing the system. Future remediation belongs in `docs/action-plan.md`, `docs/tasks.md` and `docs/future-architecture.md`.

## 1. Purpose and scope

This document records the active architecture of Billing after final F2.3 TASK-011 remediation and baseline audit. F2.3 Fiscal XML/XSD/XAdES is implemented and accepted for the confirmed local prepare/sign/verify/XSD scope. Final baseline audit score is **8.9/10**, verdict **Acceptable**; prior AUD-001 is closed for this scope. F3/Hacienda submission is not implemented.

Out of scope for this active-architecture document: target redesigns, Hacienda submission/F3, polling, callbacks, PDF, email, webhooks and microservice decomposition.

## 2. Current active architecture summary

Billing is an API-first modular monolith using NestJS, TypeScript, Prisma and PostgreSQL.

Current runtime entrypoints:

- API process: `src/bootstrap/api.main.ts`.
- Worker process: `src/bootstrap/worker.main.ts`.

F2.3 adds an in-process fiscal XML preparation path to the existing fiscal module:

```text
FiscalXmlController
  -> PrepareFiscalXmlService
    -> HaciendaV44XmlSerializerAdapter via fiscal XML serializer port
    -> FiscalSigningCertificateService -> SecretProviderPort
    -> XmlSignerPort -> NodeXadesEpesSignerAdapter
    -> XsdValidatorPort -> Xsd11ValidatorAdapter -> packaged Python xmlschema helper
    -> StoragePort
    -> Prisma persistence + AuditService
```

Active status: implemented and accepted for confirmed F2.3 scope. TASK-011 added PKCS#12/PFX and DER X.509 handling, canonicalizes document digest, `SignedProperties` digest and `SignedInfo` signature input using `xml-crypto`, and includes independent `xml-crypto` `SignedXml` verifier tests with Hacienda XPath transform.

## 3. Active architectural style and module boundaries

Active style remains a modular monolith with incremental hexagonal/ports-and-adapters conventions.

Current fiscal XML module structure:

```text
src/modules/fiscal-documents/
  application/fiscal-xml/
    fiscal-signing-certificate.service.ts
    fiscal-xml-serializer.port.ts
    prepare-fiscal-xml.service.ts
    xsd-validator.port.ts
  domain/fiscal-xml/
    fiscal-xml.errors.ts
    fiscal-xml.types.ts
    hacienda-v44-contract.ts
  infrastructure/http/
    fiscal-xml.controller.ts
    dtos/prepare-fiscal-xml.response.dto.ts
  infrastructure/xml/
    hacienda-v44-xml-serializer.adapter.ts
    xsd11-validator.adapter.ts
    xsd11/xmlschema-validator.py

src/infrastructure/signing/
  ports/xml-signer.port.ts
  adapters/node-xades-epes-signer.adapter.ts
```

Boundary note: F2.3 uses explicit ports for serializer, XSD validation, signing, secrets and storage. F2.2 fiscal creation/read/configuration still uses a larger Prisma-backed service and remains architectural debt.

## 4. Current domain map

| Domain / Module | Classification | Responsibility | Code location |
|---|---|---|---|
| Identity and Access | Core-supporting | Tenants, users, JWT, refresh tokens, API keys, scopes and company authorization. | `src/modules/identity`, `src/modules/api-keys` |
| Company Administration | Core | Company identity, ownership and Hacienda verification metadata. | `src/modules/companies` |
| Hacienda Public Queries | Supporting | Taxpayer, CABYS and exchange-rate lookups. | `src/modules/taxpayers`, `src/modules/cabys`, `src/modules/exchange-rates` |
| Hacienda Connection | Core-enabling | Per-company/per-environment Hacienda credentials and validation. | `src/modules/hacienda-connection` |
| Fiscal Documents | Core | Issuance points, sequences, idempotent invoice/ticket snapshots, retrieval and lifecycle state. | `src/modules/fiscal-documents` |
| Fiscal XML and Signing | Core-supporting within fiscal boundary | Generate Hacienda v4.4 FE/TE XML, manage XML artifacts, validate against pinned XSDs, sign/verify XML. | `src/modules/fiscal-documents/**/fiscal-xml`, `src/infrastructure/signing` |
| Audit | Generic-supporting | Audit event recording. | `src/modules/audit` |
| Cross-cutting Infrastructure | Generic | Config, database, Hacienda clients, queues, secrets, storage, signing adapters, tenant context. | `src/infrastructure` |

## 5. Current runtime components and responsibilities

| Component | Responsibility |
|---|---|
| `AppModule` | Registers infrastructure and business modules, including fiscal documents and signing infrastructure. |
| `FiscalDocumentService` | Current compact F2.2 fiscal creation/read/configuration service. |
| `FiscalXmlController` | Exposes `POST /api/v1/fiscal-documents/:id/prepare-xml`; API-key protected. |
| `PrepareFiscalXmlService` | Orchestrates existing-document XML generation, signing, verification, signed-XSD validation, artifact persistence, status transition and audit. |
| `HaciendaV44XmlSerializerAdapter` | Deterministically serializes immutable snapshots into official FE/TE v4.4 unsigned XML. |
| `Xsd11ValidatorAdapter` | Validates exact signed XML bytes against pinned Hacienda v4.4 XSD 1.1 assets using packaged `python-xmlschema` helper with local-only/defused behavior. |
| `FiscalSigningCertificateService` | Loads active scoped signing certificate metadata and secrets via `SecretProviderPort`; enforces status/date/scope before signing. |
| `NodeXadesEpesSignerAdapter` | Current XAdES-EPES signing/verifying adapter behind `XmlSignerPort`; parses PKCS#12/PFX with node-forge, embeds DER X.509 certificate data, and uses `xml-crypto` canonicalization for document digest, `SignedProperties` digest and `SignedInfo` signature input. Tests include independent `xml-crypto` verifier coverage with Hacienda XPath transform. |
| `StoragePort` adapters | Store unsigned/signed XML privately and return storage keys. |
| `AuditService` | Records fiscal XML lifecycle events without XML/secrets. |

## 6. Current dependency rules

Active intended dependency direction:

```text
Input adapter -> Application use case -> Domain helpers/policies -> Output ports <- Output adapters
```

Current deviations/limitations:

| ID | Severity | Location | Rule affected | Current impact | Recommended target |
|---|---|---|---|---|---|
| ARCH-F2.3-001 / AUD-001 | Closed for scope / Medium residual hardening | `src/infrastructure/signing/adapters/node-xades-epes-signer.adapter.ts` and tests | Output adapter should remain independently verifiable and standards-aware. | Closed for confirmed F2.3 scope by final audit after TASK-011 xml-crypto canonicalization and independent verifier evidence. Residual note: production verifier is weaker than test verifier and XMLDSig/XAdES remains manually assembled. | Preserve current port boundary; consider fuller standards library/tool in future hardening without changing `PrepareFiscalXmlService`. |
| ARCH-F2.3-002 / AUD-002 | Medium | `PrepareFiscalXmlService` | Transformation use case should enforce concurrency/idempotency boundaries. | Simultaneous duplicate prepare requests may race. | Add DB row lock/advisory lock/status transition guard and concurrency E2E. |
| ARCH-F2.3-003 / AUD-003 | Medium | `FiscalXmlController` | Expensive endpoints should be throttled/limited. | `@SkipThrottle()` bypasses throttling for XML signing/XSD work. | Define and enforce API-key throttle/quota for prepare endpoint. |
| ARCH-F2.3-004 / AUD-004 | Medium | Prisma schema relations for certificates/artifacts | Tenant/company consistency should be enforced at DB where possible. | Application checks exist, but DB constraints can be strengthened. | Add forward-only compound FK/check strategy where Prisma/PostgreSQL support allows. |
| ARCH-F2.2-001 | Medium | `FiscalDocumentService` | Application should depend on output ports rather than concrete Prisma infrastructure. | Fiscal F2.2 logic remains harder to unit-test and refactor. | Extract fiscal repository/idempotency/sequence ports incrementally. |
| ARCH-F1-001 | High | Auth throttling | Security guard enforcement should be proven. | Login/refresh rate limiting remains unproven from earlier audit. | Add threshold tests and guard registration/fix if needed. |

Positive boundary preserved: fiscal domain helper/contract files do not depend on NestJS, Prisma or external SDKs.

## 7. Current database ownership and transaction boundaries

Fiscal Documents owns:

- `fiscal_issuance_points`
- `fiscal_sequences`
- `fiscal_documents`
- `fiscal_idempotency_keys`
- `fiscal_signing_certificates`
- `fiscal_xml_artifacts`

Current transaction boundaries:

- F2.2 creation wraps idempotency reservation, sequence allocation and document persistence in one Prisma transaction.
- F2.3 prepare orchestrates artifact/status updates around signing and validation; audit found concurrent duplicate prepare attempts may race and needs explicit locking/guarding.
- Sequence allocation uses raw PostgreSQL upsert/update, not `SELECT MAX + 1`.

Current migrations include seven applied-from-zero migrations through `20260912180000_fiscal_xml_signing_metadata`.

## 8. Current API and integration contracts

All paths are under `/api/v1`.

| API | Auth | Contract summary |
|---|---|---|
| `POST /invoices` | API key + `invoices:write` | Creates invoice fiscal snapshot; status `READY_FOR_XML`. |
| `POST /tickets` | API key + `tickets:write` | Creates ticket fiscal snapshot; status `READY_FOR_XML`. |
| `GET /fiscal-documents/:id` | API key + dynamic read scope | Returns sanitized fiscal document. |
| `POST /fiscal-documents/:id/prepare-xml` | API key + service-level type/company checks | Returns prepare metadata and reaches `READY_TO_SUBMIT` when signing/verification/XSD validation succeed. No Hacienda submission is performed. |
| Fiscal management `PUT` endpoints | JWT TENANT_ADMIN | Configure issuance point and sequences. |

Integration contracts:

- XSD validation is offline/local with pinned FE/TE v4.4 assets.
- XML signing is behind `XmlSignerPort`.
- Certificate secrets are loaded through `SecretProviderPort`; DB stores references only.
- XML bytes are stored through `StoragePort`.
- No Hacienda submission/F3 integration is invoked.

## 9. Current security boundaries

- Tenant/company/environment scoping is enforced in fiscal services and queries.
- API-key endpoints require scopes and company authorization.
- Signing certificate metadata is scoped by tenant/company/environment; disabled/future-active/expired certificates fail closed before secret loading.
- Secrets/XML bodies are not logged or returned by default according to tests.
- XSD validation blocks DTD/ENTITY and remote schema-location payloads before invoking helper.
- Prior AUD-001 is closed for confirmed F2.3 scope. Non-blocking note: production verifier behavior remains weaker than stricter test `xml-crypto` standards-verifier coverage, and XMLDSig/XAdES is still manually assembled.
- Current risks: `prepare-xml` skips throttling; UUID path validation is incomplete; npm audit vulnerabilities remain.

## 10. Current container and deployment architecture

- Multi-stage `Dockerfile` builds NestJS and runner image.
- `nest-cli.json` copies required XML helper/assets to `dist/src` for runtime.
- Docker validation evidence after final TASK-011: `docker build -t billing:f23-task011-xmlcrypto-validation --target runner .` passed. Earlier packaging established helper/assets availability; this refresh did not execute container checks.
- `docker-compose.yml` remains local/development oriented; default-secret/production-mode hardening is still needed before production use.

## 11. Current testing strategy

Current test strategy includes unit tests, application tests, XSD/signing adapter tests, E2E tests and Docker validation.

Final F2.3 evidence supplied:

- Focused signing/certificate/orchestration tests passed: 18/18.
- Targeted F2.3 signing E2E passed: 1/1.
- Prisma generate/validate/migrate deploy passed.
- Full gates passed: Prisma generate/validate/migrate deploy, lint:check, typecheck, unit tests 217/217, build, full E2E 60/60.
- Docker runner build passed.

Final audit accepts the confirmed F2.3 local scope: score 8.9/10, verdict Acceptable. This refresh records user-provided evidence and did not execute commands.

## 12. Active architectural decisions

| Decision | Current status |
|---|---|
| Use modular monolith, not microservices. | Active. |
| Use NestJS + TypeScript + Prisma + PostgreSQL. | Active. |
| Keep global HTTP prefix `/api/v1`. | Active. |
| Hacienda v4.4 is the fiscal XML/XSD contract for FE/TE. | Active for F2.3. |
| F2.3 scope is prepare/sign/validate existing `READY_FOR_XML` fiscal documents only. | Active. |
| No Hacienda submission, polling, callbacks, queues, PDFs, email or webhooks in F2.3. | Active. |
| Use pinned local Hacienda XSD assets; no runtime CDN dependency. | Active. |
| Official XSD validation targets exact signed XML after signature verification because pinned schemas require `ds:Signature`. | Active. |
| Use `SecretProviderPort` for certificate/password secrets; DB stores references/metadata only. | Active. |
| Use `StoragePort` for XML artifact bytes. | Active. |
| F2.3 is complete only for local prepare/sign/verify/XSD readiness; `READY_TO_SUBMIT` is not Hacienda acceptance and F3 submission remains out of scope. | Active after final audit. |

## 13. Known architectural limitations

- XMLDSig/XAdES is still manually assembled; future hardening may replace/amend the adapter behind `XmlSignerPort` with a fuller standards library/tool.
- Concurrent `prepare-xml` processing lacks explicit locking/idempotency guard for simultaneous requests.
- `prepare-xml` is expensive and currently skips throttling.
- F2.3 DB tenant/company consistency can be hardened further.
- Certificate rotation/re-signing policy requires explicit product/architecture decision.
- Path parameter UUID validation should be standardized.
- F2.2 fiscal service remains large and Prisma-coupled.
- Docker Compose/default-secret and npm audit risks remain.

## 14. Open decisions requiring clarification

1. What is the approved prepare endpoint throttling/quota policy per API key/tenant/company?
2. What is the approved certificate rotation/re-signing policy beyond no-mutation of existing `READY_TO_SUBMIT` artifacts?
3. Should DB-level compound constraints be added for tenant/company consistency across fiscal certificates/artifacts/documents?
4. Should UUID validation be implemented globally via pipes or per-controller?
5. Should future production hardening replace the manually assembled XMLDSig/XAdES adapter with a fuller standards library/tool behind `XmlSignerPort`?
6. Should a future F3/sandbox cycle add Hacienda receiver acceptance evidence? This is out of F2.3.
