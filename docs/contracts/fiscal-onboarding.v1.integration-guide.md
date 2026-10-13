# Billing fiscal onboarding v1

## Controlled SANDBOX test invoice (Wave 7)

POST /api/v1/companies/{companyId}/fiscal-onboarding/v1/SANDBOX/test-invoices executes the existing invoice creation, XML/signature and submission-queue pipeline. It requires the inventori-fiscal-v1 profile, both invoices:write and invoices:read, a TEST API key bound to the same tenant/company, a UUID Idempotency-Key, mode=HACIENDA_SANDBOX_SUBMISSION, and confirmation=CONSUME_SANDBOX_CONSECUTIVE.

The action consumes a SANDBOX consecutive. HTTP 202 means Billing accepted the execution for processing; it never means Hacienda accepted the document. The canonical result is read with GET .../test-invoices/{executionId}. Only documents whose persisted idempotency key carries the fiscal-test:v1: namespace can be read through this facade.

Production is denied server-side with FISCAL_TEST_INVOICE_PRODUCTION_FORBIDDEN. The endpoint cannot switch to validation-only or local-mock semantics from request data. Test suites must inject the existing mock Hacienda, captured-email and isolated-storage adapters; they must not call Hacienda or SMTP.

The status response distinguishes document lifecycle, submission lifecycle and haciendaAccepted. It also returns safe artifact metadata and delivery-attempt history. Artifact bytes continue through the existing authenticated fiscal-artifact download contract; storage keys, credential references, API keys, certificate material and recipient addresses are never returned.

`inventori-fiscal-v1` is a Billing-owned capability catalog. A privileged
`TENANT_ADMIN` creates a key with `integrationProfile: "inventori-fiscal-v1"`
and binds it to exactly one company through the existing key/company bootstrap.
The returned secret is shown once and is never part of this contract.

For automated Inventori onboarding, a Tenant Admin may instead create one
tenant-bound API key with `integrationProfile: "inventori-bootstrap-v1"`.
That key has only `fiscal-bootstrap:provision`; it cannot call company fiscal
operations or administer arbitrary API keys. `POST /api/v1/fiscal-onboarding/v1/bootstrap`
creates or reuses the stable issuer association, creates a company-bound
`inventori-fiscal-v1` key, and returns that operational secret once to the
Inventori backend. The browser never receives either key. A retry after an
ambiguous response preserves the issuer and serially replaces only the prior
unconfirmed handoff credential, leaving one active operational key.

Every `/api/v1/companies/{companyId}/fiscal-onboarding/v1/{environment}` request is
authorized in this order: active API key, tenant visibility, `ApiKeyCompany`,
TEST→SANDBOX or LIVE→PRODUCTION, integration profile, then operation scope.
Denial occurs before application mutation. The profile grants no JWT role, API
key administration, tenant-global access, or authority to bind another company.

Configuration routes are usable before readiness. Fiscal creation retains its
existing scopes and repeats Wave 2 Hacienda/default-point/profile/certificate
checks immediately before reservation/allocation. Readiness is informational,
read-only and never allocates a sequence.

The stable association key is opaque and tenant/provider scoped. Equivalent
provision replay returns the canonical issuer; a different legal identity is a 409. Identification type/number locks when an ACTIVE certificate, reservation,
or fiscal document first exists. Names and profile fields remain auditable and
historical issuer snapshots never change.

Branches and terminals are Billing fiscal concepts. The effective issuance
point remains the branch-terminal pair consumed by issuance. Warehouses, stores
and receivers are neither branches nor issuers. One partial unique database
index protects the active default per tenant/company/environment.

Initial sequence configuration is create-only per point/document type. An
equivalent retry is safe. A different value, a concurrent losing initializer,
or any `lastAssigned` value returns 409. Billing remains the only allocator.

Certificate/PIN and Hacienda credentials are write-only. Responses contain only
safe lifecycle/status metadata. Certificate replacement uses the existing
durable SecretProvider and keeps the prior ACTIVE certificate if extraction,
identity/date validation, secret storage, or database activation fails.

Provider contract: `fiscal-onboarding.v1.openapi.yaml`.
Consumer fixtures: `fixtures/fiscal-onboarding.v1/`.

## Consumer contract set

Inventori must consume `fiscal-onboarding.v1.openapi.yaml` and the synthetic
`fixtures/fiscal-onboarding.v1/operation-catalog.json`. The catalog has one
entry for every one of the 25 operations and records a valid request shape,
success schema, validation failure, authorization denial, tenant/company or
environment mismatch, and relevant lifecycle or concurrency conflict. It is
not a source of credentials, certificate bytes, API keys, secret references or
private-key material.

Use the bootstrap association only through a Billing `TENANT_ADMIN`; ordinary
Inventori M2M calls use exactly one company-bound `inventori-fiscal-v1` key.
Select `SANDBOX` only with a TEST key and `PRODUCTION` only with a LIVE key.
Treat `401`, `403` and non-enumerating `404` responses as terminal for that
request; do not retry them with another company or environment. Retry only the
explicitly idempotent commands described in the OpenAPI. For a concurrent
default-point or initial-sequence conflict (`409`), re-read canonical state
before deciding whether the desired state has already been achieved.

Hacienda username/password and certificate/PIN are write-only. Inventori sends
them only over the credential/certificate write operation, never persists them
in logs or fixtures, and uses the safe status/metadata responses for follow-up.
Readiness is informative; fiscal issuance still repeats authoritative
eligibility checks immediately before it allocates an identity or sequence.
