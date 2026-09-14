# Current Code Audit

## Executive Summary

Final current-code audit state for confirmed specification `specs/f2-2-to-f2-3-end-to-end-fiscal-data-remediation/`.

Audit scope: cross-phase fiscal-data remediation from normal F2.2 FE/TE API creation through F2.3 XML serialization/signing/XSD validation to `READY_TO_SUBMIT`.

F3/Hacienda submission was not evaluated as implemented behavior and remains **NOT STARTED**.

## Final Verdict

- Verdict: **PASS with non-blocking concerns**.
- Score: **8.8/10**.
- TASK-021 status: Completed.
- TASK-022 status: Completed after documentation reconciliation.

## Implemented Current State

- `CompanyFiscalProfile` owns issuer fiscal readiness data, including structured fiscal address and `proveedorSistemas`.
- F2.2 validates readiness before `READY_FOR_XML` and snapshots issuer, receiver, line, tax, unit, sale condition, payment and totals data into immutable `FiscalDocument` records.
- F2.3 serializes Hacienda v4.4 FE/TE XML from immutable fiscal document snapshots and does not reread mutable Company/CompanyFiscalProfile/Customer state for historical XML.
- Normal FE and TE API-created documents reach `READY_TO_SUBMIT` through signing, local verification and pinned official XSD validation.

## TASK-021 Remediation Confirmed

Initial final audit found blockers around fabricated or incomplete fiscal data. Those blockers were remediated:

- Non-zero line tax requires explicit metadata: `taxCode`, `taxRateCode`, `taxRate`, `taxAmount`.
- F2.2 rejects non-zero `taxAmount` without complete metadata before `READY_FOR_XML`.
- Invalid tax metadata is rejected.
- F2.3 serializer uses tax metadata from immutable line snapshots.
- Non-zero `discountAmount` is unsupported and rejected before `READY_FOR_XML`.
- Serializer rejects unsupported discounts for legacy seeded documents.
- Unsupported unit measures are rejected before `READY_FOR_XML`; supported values are `Sp` and `Unid`.
- Unsupported sale/payment conditionals are rejected before `READY_FOR_XML`: saleCondition `02`, `09`, `11`, `99`; paymentMethod `99`.
- `CompanyFiscalProfile.proveedorSistemas` is required for readiness, snapshotted by F2.2 and serialized by F2.3.

## Validation Evidence

TASK-021 remediation validation:
- `npm run test -- hacienda-v44-xml-serializer.adapter fiscal-identification.mapper --silent` — PASS, 2 suites / 10 tests.
- `npm run typecheck` — PASS.
- `npm run lint:check` — PASS.
- `npm run build` — PASS.
- Targeted E2E fiscal-documents + fiscal-xml-signing — PASS, 2 suites / 11 tests.

Prior TASK-019/TASK-020 validation remains recorded as passing:
- Prisma generate / validate / migrate deploy.
- Unit suite: 36 suites / 226 tests.
- Full E2E: 14 suites / 70 tests.
- Docker build.

## Explicit Audit Answers

1. Normal FE API-created invoice can contain immutable F2.3 data and reach `READY_TO_SUBMIT`: YES.
2. Normal TE API-created ticket can contain immutable F2.3 data and reach `READY_TO_SUBMIT`: YES.
3. Immutable F2.2 snapshot contains all F2.3 data for the current supported FE/TE scope: YES.
4. F2.3 rereads mutable Company/CompanyFiscalProfile/Customer data after `READY_FOR_XML`: NO.
5. `READY_FOR_XML` is a reliable completeness invariant for the supported scope: YES.
6. Normal FE passes serialization, PFX/X.509 signing path, XAdES-EPES/XMLDSig verification, official FE XSD and reaches `READY_TO_SUBMIT`: YES.
7. Normal TE passes serialization, PFX/X.509 signing path, XAdES-EPES/XMLDSig verification, official TE XSD and reaches `READY_TO_SUBMIT`: YES.
8. Unsafe fake/default fiscal data is removed or prevented from becoming authoritative for approved scope: YES.
9. Unsupported conditional fiscal features are explicitly rejected for current approved scope: YES.
10. Security, isolation, idempotency, concurrency and audit guarantees are preserved by tested evidence: YES.

## Non-blocking Concerns

- F3 Hacienda submission, response handling, polling, retry and reconciliation remain future work.
- Current supported fiscal feature set is intentionally narrow; additional Hacienda conditionals require explicit approved design, snapshot fields, serializer mapping and tests.
- Prepare-XML concurrent duplicate request hardening remains future work.
- Dependency vulnerability triage remains separate future work.
- Serializer retains defensive rejection paths for legacy seeded documents that bypass current F2.2 validation.

## Current Boundary

`READY_TO_SUBMIT` means the document completed creation, immutable fiscal snapshot readiness, Hacienda v4.4 XML serialization, XML signing, local verification and XSD validation. It does **not** mean Hacienda acceptance.
