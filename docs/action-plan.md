# Architectural Action Plan

> **Synchronized:** Final F2.2/F2.3 cross-phase remediation refresh for confirmed `specs/f2-2-to-f2-3-end-to-end-fiscal-data-remediation/` by `sdd-implementation-agent-458e19` on 2026-09-13 with `hdd-architecture-agent` guidance. TASK-001 through TASK-022 are complete. Final audit PASS with non-blocking concerns, score **8.8/10**. F2.2/F2.3 remediation is complete through `READY_TO_SUBMIT`; F3/Hacienda submission remains **NOT STARTED**.
>
> **Completed remediation scope:** tax metadata is explicit and snapshotted; invalid/missing tax metadata rejects before `READY_FOR_XML`; non-zero discounts are unsupported/rejected; supported units are `Sp`/`Unid`; unsupported sale/payment conditionals reject; `proveedorSistemas` is required, snapshotted and serialized; normal FE/TE API paths reach `READY_TO_SUBMIT`.

> **Synchronized:** Final F2.3 architecture documentation refresh by `hdd-architecture-agent-d7922b` on 2026-09-13 for confirmed `specs/fase-2-3-fiscal-xml-signing/` scope. Documentation-only; no production code, tests, Prisma schema or migrations modified.
> Final baseline audit result supplied by the user: **Overall Score 8.9/10**, **Verdict Acceptable**. Prior **AUD-001 is closed for the confirmed F2.3 acceptance scope** and is no longer blocking. Remaining notes are non-blocking hardening items.

## 1. Objective

Record the final accepted F2.3 local XML preparation architecture and keep the forward plan limited to non-blocking hardening. F2.3 ends at `READY_TO_SUBMIT`; Hacienda submission/F3 is not started.

## 2. Scope

In scope for this documentation refresh:

- Reflect actual F2.3 implementation state.
- Record final audit acceptance: 8.9/10 Acceptable, AUD-001 closed for F2.3 scope.
- Preserve validation evidence provided by the implementation cycle.
- Document remaining non-blocking notes: production verifier weaker than test standards verifier, XMLDSig/XAdES manually assembled, concurrent duplicate prepare requests not characterized, F2.3 verification docs partially stale, dependency vulnerabilities known/out of scope.

## 3. Out of scope

- Hacienda submission/F3 (`POST /recepcion`, polling, callbacks, queues, acceptance/rejection handling).
- Production taxpayer certificates in repository.
- PDF, email, webhooks or notifications.
- Microservice extraction.
- Editing already-applied migrations.
- Remediating dependency vulnerabilities in this refresh.

## 4. Requirements addressed

F2.3 requirements are implemented for the confirmed acceptance scope:

| Requirement area | Final state |
|---|---|
| FE/TE v4.4 XML generation | Implemented from immutable F2.2 snapshots. |
| Official assets | Pinned Hacienda v4.4 FE/TE XSDs, policy PDF and manifest under `resources/hacienda/v4.4`. |
| XSD validation | `XsdValidatorPort -> Xsd11ValidatorAdapter -> packaged Python xmlschema helper`; local-only, no runtime CDN. |
| Certificate metadata/secrets | Prisma metadata and migration exist; secrets loaded through `SecretProviderPort`; plaintext secrets not stored in DB. |
| Signing | `NodeXadesEpesSignerAdapter` signs XAdES-EPES with PKCS#12/PFX support and DER X.509 embedding. TASK-011 canonicalizes document digest, `SignedProperties` digest and `SignedInfo` signature input using `xml-crypto`. |
| Independent verification | Tests include `xml-crypto` `SignedXml` independent verifier with Hacienda XPath transform; valid FE/TE pass, tamper fails. |
| Lifecycle | `PrepareFiscalXmlService` reaches `READY_TO_SUBMIT` after sign, verify and official signed-XSD validation. |
| No F3 | No Hacienda submission/polling/callback behavior added. |

## 5. Current problems addressed

Closed for this scope:

- AUD-001 is no longer blocking. Final audit accepted TASK-011 canonicalization and independent verifier evidence for confirmed F2.3 acceptance scope.
- Prior documentation ambiguity stating F2.3 was blocked is corrected by this refresh.

Remaining non-blocking problems:

- Production verifier is weaker than stricter test standards verifier coverage.
- XMLDSig/XAdES remains manually assembled.
- Simultaneous duplicate `prepare-xml` requests are not characterized.
- Some F2.3 verification/status documents were stale before this refresh and may need periodic reconciliation after future changes.
- Known dependency vulnerabilities remain out of scope.

## 6. Domains affected

| Domain | Impact |
|---|---|
| Fiscal Documents | Lifecycle now includes XML/signing metadata and `READY_TO_SUBMIT`. |
| Fiscal XML and Signing | Implemented serializer, XSD validator, signer/verifier and artifact preparation flow. |
| Secrets / Storage | Certificate secrets and XML artifacts remain behind ports. |
| Persistence | Prisma metadata and migration `20260912180000_fiscal_xml_signing_metadata` are active. |
| Audit | Fiscal XML lifecycle events are recorded without XML/secrets. |
| Security | F2.3 secret isolation and local XML parser/network controls are implemented; throttling/dependency hardening remains future work. |

## 7. Behavior to preserve

- F2.3 processes existing `READY_FOR_XML` fiscal documents only.
- Immutable F2.2 snapshots are the XML source of truth.
- Deterministic unsigned FE/TE v4.4 XML generation.
- Pre-sign checks occur before certificate/signing work.
- Exact signed XML bytes are locally verified and then validated against pinned official XSDs.
- Exact signed bytes are stored/hashed and status becomes `READY_TO_SUBMIT`.
- `READY_TO_SUBMIT` retry returns existing artifact metadata and does not silently mutate signed XML.
- No Hacienda submission/F3 side effects.
- XML bodies, private keys, certificate bytes and passwords are not logged/audited/returned by default.

## 8. Defects to correct

No F2.3 blocking defects remain for the confirmed acceptance scope.

Future non-blocking corrections:

| Finding | Priority | Correction direction |
|---|---|---|
| Production verifier weaker than test verifier | Medium | Align production verification with the stricter `xml-crypto` standards-verifier checks or document why adapter verification remains sufficient at runtime. |
| XMLDSig/XAdES manually assembled | Medium | Consider replacing/amending signer behind `XmlSignerPort` with fuller standards-based library/tool. |
| Concurrent duplicate prepare not characterized | Medium | Add locking/compare-and-set characterization and E2E coverage. |
| Prepare endpoint cost protection | Medium | Define throttle/quota policy. |
| DB tenant/company consistency hardening | Medium | Evaluate compound constraints/indexes. |
| UUID path validation | Medium | Add global or per-route UUID validation. |
| Dependency vulnerabilities | High | Triage and remediate in separate supply-chain task. |

## 9. Future architectural changes

Future work should remain incremental:

1. Add characterization tests for simultaneous duplicate `prepare-xml` requests.
2. Decide rate limit/quota for expensive XML signing/XSD validation endpoint.
3. Consider moving production verification to the same strict standards-verifier pattern used in tests.
4. Evaluate replacing manual XMLDSig/XAdES assembly behind `XmlSignerPort` without changing `PrepareFiscalXmlService`.
5. Harden DB tenant/company consistency with forward-only migrations if feasible.
6. Triage npm dependency vulnerabilities separately.
7. Start F3 only through a new approved SDD specification.

## 10. Database changes

Implemented:

- Migration `prisma/migrations/20260912180000_fiscal_xml_signing_metadata`.
- Lifecycle/artifact/certificate metadata in Prisma.

Proposed future changes only if approved:

- Optional row/advisory locking or status-guard support for concurrent prepare requests.
- Optional compound constraints/FKs for tenant/company consistency.
- Never edit already-applied migrations; use forward-only migrations.

## 11. API and integration changes

Implemented:

- `POST /api/v1/fiscal-documents/:id/prepare-xml` prepares XML and returns sanitized metadata.

Future only if approved:

- Add deterministic invalid-UUID behavior.
- Add documented 429 behavior for prepare endpoint throttling/quota.
- No Hacienda submission endpoint until F3.

## 12. Container and deployment changes

Implemented/evidenced:

- XSD helper/assets packaged for runtime.
- Final Docker evidence: `docker build -t billing:f23-task011-xmlcrypto-validation --target runner .` passed.

Future:

- If production verifier strategy changes, validate Docker packaging again.
- Keep Docker Compose/default-secret hardening separate from F2.3 closure.

## 13. Security changes

Implemented:

- Certificate secrets loaded through `SecretProviderPort`; DB stores references only.
- XSD validation blocks DTD/ENTITY and runtime remote schema behavior.
- No XML/secrets in audit/API responses by default.
- SHA-1 prohibited by contract/tests.

Future:

- Prepare endpoint throttling/quota.
- UUID path validation.
- Dependency vulnerability remediation.
- Optional stricter production verifier alignment.

## 14. Test strategy

Final validation evidence supplied:

- `npx prisma generate`, `npx prisma validate`, `npx prisma migrate deploy` with `DATABASE_URL` passed.
- `npm run lint:check` passed.
- `npm run typecheck` passed.
- `npm test -- --silent` passed: 217/217.
- `npm run build` passed.
- `npm run test:e2e -- --silent --runInBand` passed: 60/60.
- Docker runner build passed: `billing:f23-task011-xmlcrypto-validation`.
- TASK-011 signer tests include `xml-crypto` `SignedXml` independent verifier with Hacienda XPath transform; valid FE/TE pass signer verify, xml-crypto verify and XSD; tamper fails.

This architecture refresh did not execute commands.

## 15. Migration stages

| Stage | Status | Notes |
|---|---|---|
| F2.3 implementation | Complete for confirmed scope | Implemented by `sdd-implementation-agent-4a564c`. |
| Final audit acceptance | Complete | 8.9/10 Acceptable; AUD-001 closed for scope. |
| Documentation refresh | Complete by this task | Docs/specs refreshed to remove stale blocked status. |
| Non-blocking hardening | Proposed | Concurrency, throttling, DB constraints, verifier alignment, UUID validation, dependency triage. |
| F3 submission | Not started | Requires separate approved SDD. |

## 16. Risks and mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| `READY_TO_SUBMIT` misread as Hacienda acceptance | High | Documentation states it is local readiness only; F3 not implemented. |
| Concurrent duplicate prepare race | Medium | Add future characterization/locking task. |
| Expensive endpoint abuse | Medium | Add future quota/throttling task. |
| Manual XMLDSig/XAdES assembly drifts | Medium | Keep tests and consider standards-library adapter behind `XmlSignerPort`. |
| Dependency vulnerabilities | High | Separate supply-chain remediation task. |
| Real taxpayer cert leakage | Critical | Continue using only test/generated fixtures; never commit production cert material. |

## 17. Rollback or recovery strategy

- Documentation changes can be reverted if inaccurate.
- Signing/verifier future changes should remain behind `XmlSignerPort`.
- DB future changes must be forward-only with migration validation.
- Operationally, failed F2.3 processing should remain retryable unless a signed `READY_TO_SUBMIT` artifact already exists.

## 18. Manual validation

For local F2.3 scope:

1. Prepare a `READY_FOR_XML` invoice and ticket.
2. Configure test-only PFX/password secrets through `SecretProviderPort`.
3. Call `/api/v1/fiscal-documents/:id/prepare-xml`.
4. Confirm `READY_TO_SUBMIT`, artifact metadata, hashes and no XML/secret leakage.
5. Confirm signer verify, `xml-crypto` verifier and pinned XSD validation pass.
6. Retry and confirm no signed XML mutation.
7. Tamper a copy and confirm verification failure.
8. Confirm no Hacienda submission calls exist.

## 19. Approval status

- F2.3 is accepted for the confirmed local prepare/sign/verify/XSD scope.
- AUD-001 is closed for this scope and no longer blocking.
- Remaining hardening tasks are **Proposed** and require explicit approval before code changes.
- Hacienda submission/F3 remains **not started**.
