# Fiscal identity lookup v2 — canonical fiscal evidence

**Endpoint:** `POST /api/v1/companies/{companyId}/fiscal-documents/{environment}/identity-by-fiscal-evidence`

This is a read-only recovery endpoint for a prior completed fiscal identity whose historical Billing request hash differs from Inventori's old payload hash. It does **not** replace, derive, or update Billing's internal idempotency hash and it never creates a fiscal document, allocates a consecutive, prepares XML, contacts Hacienda, or starts delivery.

## Required proof

Send an authorized `X-API-Key` and a JSON body containing:

- the original `idempotencyKey`;
- the original `operation` (`fiscal-document.create.invoice` or `fiscal-document.create.ticket`);
- `equivalenceContractVersion: "fiscal-payload-equivalence.v1"`;
- `fiscalPayload`, with exactly the fiscal-create fields listed in the OpenAPI contract.

Billing authenticates the current key, requires the read scope for the document type, and requires the current key to be authorized for the requested company. It intentionally does not predicate the historical search on `api_key_id`, so an authorized replacement key can discover an identity created before API-key rotation.

## Canonical representation v1

The byte sequence is UTF-8 JSON with recursively lexicographically sorted object keys and no whitespace. The root contains `contractVersion` and `fiscalPayload`.

Tenant, company, environment, and type inferred from `operation` are authenticated route scope, not caller-supplied hash material. Billing binds every equivalence comparison to that scope before returning a document. The fiscal payload includes `receiver`, `currency`, `exchangeRate`, `saleCondition`, `creditTermDays`, `paymentMethod`, and ordered `lines`.

- Decimal fields are parsed at scale 5 and emitted with exactly five fractional digits.
- `undefined` object fields are omitted only inside arbitrary receiver JSON; optional fiscal fields normalize to `null`.
- JSON `null` is preserved.
- Arrays preserve their original order; line order is fiscal evidence and is never sorted.
- Receiver object keys are sorted recursively. Date-only strings in fields ending in `Date` or `At` retain `YYYY-MM-DD`; ISO timestamps in those fields normalize to UTC `toISOString()`.
- Text is not trimmed or case-folded. Callers must supply the original fiscal content, not an approximation.

The reference vector is [INV-966 historical fiscal evidence — sanitized](fixtures/fiscal-payload-equivalence.v1/inv-966-historical-sanitized.json). Inventori must reproduce its `expectedSha256` exactly for future create requests. Historical recovery sends the original fiscal payload; Billing calculates the same representation internally so an old Inventori hash is never required retroactively.

## Result handling

A `200` response confirms that one completed reservation, its linked document, the original internal request hash relationship, authenticated domain identity, and independent canonical payload evidence all agree. `404 FISCAL_IDENTITY_NOT_FOUND` is deliberate safe non-disclosure, including a payload mismatch. `409` means ambiguity or persisted-data integrity failure and requires operator review. Neither result authorizes creation of another fiscal document.

The existing v1 `GET .../identity-by-idempotency` contract remains unchanged for records where Inventori has the exact historical Billing request hash.
## Future create requests

For new fiscal creation, Inventori may opt in by sending both headers:

- `X-Fiscal-Payload-Contract-Version: fiscal-payload-equivalence.v1`
- `X-Fiscal-Payload-Hash: <expectedSha256>`

Billing verifies the pair against the request payload before allocating fiscal identity. Supplying only one header, an unsupported version, or a mismatched hash fails closed. Supplying neither preserves existing create behavior. These headers are excluded from Billing's existing internal idempotency hash and are not retroactively required for historical recovery.