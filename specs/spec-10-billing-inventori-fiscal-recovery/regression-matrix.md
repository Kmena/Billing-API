# Diferencias y regresiones

F4-S = commit `04e7f1e`; Billing histórico = imagen `a4a02cbc…` usada por Inventori (SHA de código no determinado); SPEC-09 = imagen `53b3ab76…`, código `33df203`. No atribuir propiedades de una imagen solo por su etiqueta.

| Tema | F4-S funcional | Billing histórico / Inventori | Billing SPEC-09 | Clasificación y evidencia |
| --- | --- | --- | --- | --- |
| Recepción STAG | Host dedicado `api-sandbox…/recepcion/v1/recepcion` observado | Inventori delega a Billing; endpoint efectivo actual no verificado porque `USE_REAL_HACIENDA=false` | Inicialmente host compartido `/recepcion-sandbox/v1/`, POST 403; `33df203` instala host dedicado | **Regresión confirmada de configuración**, corregida localmente; la recepción actual sigue pendiente. Error anterior `IncompleteSignatureException` indica Bearer interpretado como SigV4 en gateway. |
| Consulta | `GET /recepcion/v1/recepcion/{clave}`; `ind-estado=aceptado` | Inventori consulta proyección Billing, no Hacienda directamente | Mismo adaptador; consultas 400 previas, causa definitiva no confirmada | Pendiente de verificar; HTTP 400 no prueba ausencia ni rechazo del documento. |
| OAuth | IDP `rut-stag`, `api-stag`, password grant, token 200 | Credenciales custodiadas por Billing | Mismo IDP/cliente según configuración | Mejora compatible: validación de credenciales. Token 200 no concede necesariamente recepción. |
| POST sobre/headers | JSON `clave`, `fecha`, `emisor`, `receptor`, `comprobanteXml`; Bearer | Inventori solo envía solicitud a Billing v1 | Adaptador F4-S reutilizado, diferencias posteriores principalmente diagnóstico | Componente común; ninguna regresión del sobre confirmada. |
| XML/XSD/firma | XML 4.4 y XAdES-EPES aceptados | Producidos por Billing | Mismos servicios base, con onboarding y guards adicionales | Mejora compatible; no se validó XML de SPEC-09 ante Hacienda. |
| Consecutivo/idempotencia | Billing reserva y persiste; reconciliación tras 202 | Inventori fija idempotencia de intención y `billingFiscalDocumentId` | Billing v2 enlaza operación por asociación; factura SPEC-09 única | Cambio intencional; consolidar bases exige resolver secuencias y documentos sin renumerar. |
| Estados | 202→`POST_OUTCOME_UNKNOWN`→GET→`ACCEPTED` | Inventori observa estado Billing | Factura SPEC-09 queda `MANUAL_REVIEW_REQUIRED` tras POST 403 | Correcto no inferir aceptación. El estado remoto sigue desconocido. |
| Reintento | Ambigüedad requiere conciliación antes de repetir | Worker conserva documento e idempotencia | Script manual excepcional añadió contraseña Billing | Cambio intencional de control, pero **acoplamiento operativo innecesario** si se exige para facturación ordinaria. No afecta primer POST. |
| M2M | API key v1 | Inventori v1 | Afiliaciones v2 con scopes/empresa/ambiente | Cambio intencional compatible si v1 permanece intacto. |
| Secretos | Billing custodio | Almacén histórico separado | Almacén cifrado SPEC-09 separado; claves maestras no comparadas | Una huella de certificado activo coincide, pero la migración de secretos no está demostrada. |
| PDF/XML/correo | Entrega real del documento F4-S diferida | Inventori ofrece proxy de artefactos y solicitud de reenvío | SMTP protegido disponible, `EMAIL_USE_REAL=false` | Capacidad de código, no evidencia de entrega actual. |
| Recuperación | Persistencia y GET de estado | Intención/reconciliación en Inventori | Worker/guardas v2 y almacén durable | Mejoras compatibles; falta ensayo integral intersistemas. |

**Hipótesis pendiente:** el POST SPEC-09 desde el host corregido podría funcionar como F4-S, pero no hay prueba y SPEC-10 prohíbe solicitarla. La factura existente mantiene `MANUAL_REVIEW_REQUIRED`; `RETRY_SAFE=NO`. La autenticación administrativa fallida en el procedimiento `f517eed` no es causa del 403 inicial ni evidencia de un nuevo rechazo de Hacienda.

El desglose paso a paso está en `f4s-spec09-communication-matrix.md`. El delta de código F4-S→SPEC-09 añade validación estricta de OAuth y recuperación periódica/singleton de jobs; el adaptador de recepción conserva URL builder, sobre y headers. En la instalación hay 19 checksums de migraciones compartidas distintos por CRLF, pero los 24 SQL compartidos son iguales tras normalización; véase `installation-reconciliation.md`.
