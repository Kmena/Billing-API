# Arquitectura instalada, inventario de solo lectura

Consulta del 2026-11-06. `docker ps -a` e `inspect`; no se inspeccionó contenido de volúmenes ni valores de secretos.

| Servicio | Imagen observada / salud | Conexión y custodia observables |
| --- | --- | --- |
| `inventori-api` | `sha256:140f463cdf4af564…`, `unhealthy` | `BILLING_BASE_URL=http://billing-api:3000`, redes `billing_default` e `inventory-api_default`; scheduler fiscal `false`, correo real `false`. |
| `billing-api` + `billing-worker` históricos | Ambos `sha256:a4a02cbc69eb1921…`, `healthy` | Red `billing_default`; PostgreSQL `billing-postgres`; volúmenes de secretos y clave de operador; artefactos en bind mount. La etiqueta 20261013 **no acredita SHA de fuente**. |
| `billing-postgres` y `billing-localstack` | Ambos `healthy` | Datos y almacén de objetos propios de Billing histórico. |
| Billing SPEC-09 `spec09-billing-billing-spec09-sandbox-1` | `sha256:53b3ab7651526879…`, `healthy`; commit de código autorizado `33df203` | Red `spec09_billing_backend` y `aflilientions_internal`; `spec09-billing-postgres-1`; volúmenes cifrados, fiscales y clave. STAG endpoint dedicado; producción apunta a URL inerte; envío y correo real `false`. |
| Afiliaciones `aflilientions-api-1`/`web-1` | API `sha256:6c81eacecdd4d561…`, healthy; Web `sha256:6655dc7247ad609b…` | PostgreSQL `aflilientions-postgres-1`; onboarding hacia Billing SPEC-09 por HTTPS; `BILLING_ENABLED=false` y `BILLING_MEMBERSHIP_STAG_ENABLED=false`. |

**Hay dos instalaciones Billing activas** y dos PostgreSQL/almacenes fiscales separados. Inventori apunta al Billing histórico; Afiliaciones al SPEC-09. No se ha demostrado que compartan emisores, certificados, credenciales, actividades, consecutivos o documentos. El código de Billing SPEC-09 reutiliza los modelos y el adaptador Hacienda históricos, pero eso no unifica los datos persistidos. El `inventori-api` está unhealthy y su base Compose propia figura detenida; se desconoce su dependencia efectiva de datos sin inspección posterior. No se cambió su estado.

| Dato | Fuente de verdad actual | Riesgo al consolidar |
| --- | --- | --- |
| Emisor, P12/PIN, Hacienda, actividades, sucursal/terminal | Cada Billing en su propio PostgreSQL + secret store | Coincidencias de identidad no implican mismos secretos ni versiones. |
| Consecutivos, clave, XML, estado fiscal, respuesta | Billing que emitió cada documento | No copiar ni renumerar; preservar jurisdicción histórica por documento. |
| Intención, factura comercial, cliente, pago | Inventori o Afiliaciones, respectivamente | Mantener IDs externos e idempotencia; no duplicar documentos. |
| PDF/XML y entrega | Billing correspondiente; Inventori puede exponerlos por proxy | Reconciliar artefactos y resultados de correo antes de retirar una instancia. |

El adaptador v1 de Inventori usa `X-API-Key` y rutas `/api/v1/...`; la configuración de Afiliaciones usa credencial M2M v2 vinculada por empresa/ambiente y su emisión de laboratorio usa operaciones v2 con scopes. Son contratos coexistentes, no dos integraciones de Hacienda. `src/modules/fiscal-documents/infrastructure/submission/hacienda-recepcion.adapter.ts` sigue siendo el transporte fiscal de Billing.
