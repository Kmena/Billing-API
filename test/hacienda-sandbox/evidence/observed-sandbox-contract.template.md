# Observed Sandbox Contract

## Status
NOT_EXECUTED — to be populated only by real F4-S execution (TASK-008+).

Do NOT edit this template manually.
This file is populated automatically by the F4-S evidence collector after real sandbox execution.

---

## Runtime endpoint observations

### Authentication
| Field | Observed value | Status |
|---|---|---|
| Token endpoint (actual URL used) | NOT_EXECUTED | NOT_EXECUTED |
| HTTP status | NOT_EXECUTED | NOT_EXECUTED |
| Token received | NOT_EXECUTED | NOT_EXECUTED |
| Token lifetime (seconds) | NOT_EXECUTED | NOT_EXECUTED |

### Reception
| Field | Observed value | Status |
|---|---|---|
| Reception base URL (actual hostname used) | NOT_EXECUTED | NOT_EXECUTED |
| POST /recepcion HTTP status | NOT_EXECUTED | NOT_EXECUTED |
| Location header received | NOT_EXECUTED | NOT_EXECUTED |

### Status reconciliation
| Field | Observed value | Status |
|---|---|---|
| GET /recepcion/{clave} HTTP status | NOT_EXECUTED | NOT_EXECUTED |
| ind-estado values observed | NOT_EXECUTED | NOT_EXECUTED |
| Terminal state reached | NOT_EXECUTED | NOT_EXECUTED |
| respuesta-xml received | NOT_EXECUTED | NOT_EXECUTED |

### Rate limiting
| Field | Observed value | Status |
|---|---|---|
| X-Ratelimit-Limit header | NOT_EXECUTED | NOT_EXECUTED |
| X-Ratelimit-Remaining header | NOT_EXECUTED | NOT_EXECUTED |
| X-Ratelimit-Reset header | NOT_EXECUTED | NOT_EXECUTED |
| Retry-After header (if 429 observed) | NOT_EXECUTED | NOT_EXECUTED |

---

## Endpoint discrepancy resolution

| Candidate | Used? | Observed HTTP status |
|---|---|---|
| `https://api-sandbox.comprobanteselectronicos.go.cr/recepcion/v1` (PRIMARY_RUNTIME_CANDIDATE) | NOT_EXECUTED | NOT_EXECUTED |
| `https://api.comprobanteselectronicos.go.cr/recepcion-sandbox/v1/` (OFFICIAL_PUBLISHED_CONTRACT_VALUE — NOT in allowlist) | NOT USED | N/A |

---

## Security observations
- Authorization header in evidence: NOT PRESENT (by design — never serialized)
- Bearer token in evidence: NOT PRESENT (by design — never serialized)
- Certificate bytes in evidence: NOT PRESENT (by design — never serialized)

---

*This template is committed. Completed evidence files are in `test-output/hacienda-sandbox/` which is gitignored.*
