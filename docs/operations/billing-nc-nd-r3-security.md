# W4-B-R3 — seguridad multiempresa

El laboratorio creó dos empresas, emisores, receptores, facturas aceptadas sintéticas y API keys autorizadas por empresa. Se probó POST, GET por ID y GET por clave idempotente a través de los guards reales.

| Control | Evidencia HTTP |
|---|---|
| API key ausente | GET 401 |
| API key de A para ruta de B | POST y GET 403 |
| Original de B citado en POST de A | 404, sin revelar el original |
| GET por clave de B desde A | 403 |
| Scope solo lectura | POST 403; GET NC propia 200; GET ND sin scope 403 |
| Emisor del original alterado | POST 409 |
| Secreto en respuesta | No aparece en el JSON de GET permitido |
| Auditoría | Filas `fiscal_note_audit` para la NC comprobada |

La clave idempotente queda acotada por tenant, empresa, API key y operación. Estos controles se ejercitaron con datos sintéticos de dos empresas en una base aislada; no afirman un pentest ni autorizan exposición pública. El módulo de laboratorio continúa fuera de la aplicación instalada.

**Seguridad multiempresa M2M: PASS_LAB.**
