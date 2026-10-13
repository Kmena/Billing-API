# Fiscal identity lookup v1 — Inventori integration guide

**Endpoint:** `GET /api/v1/companies/{companyId}/fiscal-documents/{environment}/identity-by-idempotency`

Send `X-API-Key` and these required query parameters:

- `idempotencyKey`: the persisted original Inventori intent key.
- `operation`: `fiscal-document.create.invoice` for Inventori invoices.
- `requestHash`: the exact original `InvoiceFiscalIntent.metadata.billingPayloadHash`, never a recalculated value.

The API key must be currently authorized for the requested company and include `invoices:read` for invoice lookup (`tickets:read` for ticket lookup). The lookup is read-only and remains discoverable after API-key rotation.

A `200` response proves the returned identity is complete and bound to the authenticated tenant, requested company, requested environment, operation, idempotency key, and hash. Inventori must independently compare every returned identity field to its local intent/configuration before one transactional association. It must not take a `404`, `409`, or `5xx` as authority to create a new fiscal document.

Error classification: `404 FISCAL_IDENTITY_NOT_FOUND` is safe non-disclosure (including hash mismatch); `403` is authorization failure; `409 FISCAL_IDENTITY_AMBIGUOUS` or `FISCAL_IDENTITY_INTEGRITY_ERROR` requires operator review; `500 INTERNAL_SERVER_ERROR` is transient and must not trigger creation.

Version policy: consumers pin to v1 semantics and treat unknown required response fields/statuses as incompatible until reviewed. Billing may add optional response fields only in a backward-compatible v1 release; any semantic or required-field change needs a new contract version.
