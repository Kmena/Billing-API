# F4-S frente a SPEC-09: comunicación Hacienda

Comparación de código entre `04e7f1e40b86775aba88601a878ea5efe7b4b7c6` (F4-S) y `33df203cff798bc470670ad37e27e8177fab0769` (imagen SPEC-09 autorizada). Evidencia externa histórica: TASK-009-STATUS, POST previo 202 y GET 200 con `ind-estado=aceptado`. Ningún GET/POST se realizó para esta auditoría.

| Paso | F4-S observado o implementado | SPEC-09 actual | Clasificación y control pendiente |
| --- | --- | --- | --- |
| 1. OAuth | `HaciendaOidcAuthAdapter`: password grant, IDP `rut-stag`, cliente `api-stag`; token HTTP 200 en F4-S | Mismo adaptador e IDP; añadió rechazo de respuestas inválidas, límites de cuerpo y cero redirecciones | Mejora compatible. Autenticación no demuestra autorización de recepción. |
| 2. XML y firma | XML v4.4, XSD, XAdES-EPES, P12/identidad; FE aceptada | Reutiliza servicios; onboarding, perfil, actividad y guards reforzados | No se perdió el mecanismo F4-S. Validar cada documento moderno y tratamiento fiscal por tipo. |
| 3. URL POST | Base dedicada `https://api-sandbox.comprobanteselectronicos.go.cr/recepcion/v1` + `recepcion` | Inicialmente base distinta en host compartido; commit `33df203` instaló la base F4-S | Regresión de configuración confirmada y corregida. Disponibilidad actual de STAG aún no demostrada. |
| 4. Sobre y headers | `clave`, `fecha`, `emisor` y `receptor` planos, `comprobanteXml` Base64; `Authorization: bearer`, JSON UTF-8 | `HaciendaRecepcionAdapter` conserva la misma construcción. Diff entre commits para este adaptador es formato de fuente, no cambio observado en estos campos | Reutilizar el mismo adaptador. Probar bytes y URL final con servidor simulado. |
| 5. HTTP 202 | F4-S observó 202 y guardó `POST_OUTCOME_UNKNOWN` | Clasifica 2xx no documentado, incluido 202, como resultado sin resolver; guarda metadatos seguros | Preservado. Prohibido marcar ACCEPTED solo por 202. |
| 6. Consulta | `GET` base + `recepcion/{clave}`, Bearer | Misma ruta en el adaptador; SPEC-09 tuvo consultas HTTP 400 previas sin respuesta concluyente | Código compatible; causa remota del 400 pendiente. No consultar sin autorización. |
| 7. Estado | `ind-estado=aceptado`, `Mensaje=1`, respuesta XML; estado terminal ACCEPTED | Parser y máquina de estados aceptan `recibido/procesando/aceptado/rechazado`; diagnóstico HTTP ampliado | Mejora compatible; conservar distinción entre técnica y fiscal. |
| 8. Persistencia/recuperación | Submission y artefacto fiscal guardados; conciliación sin repost | Worker añadió timer de recuperación, singleton de cola y cierre del timer; idempotencia v1/v2 | Mejora compatible que requiere pruebas de reinicio/concurrencia. Factura SPEC-09 permanece MRR. |
| 9. Entrega | F4-S **no observó entrega del documento aceptado** | Billing incluye PDF, XML, respuesta, cola y SMTP cifrado; correo real está apagado | Capacidad de código, no prueba de entrega externa. Ensayar paquete íntegro y SMTP capturado. |

El POST 403 de SPEC-09 se produjo antes de corregir la base SANDBOX. El diagnóstico local `IncompleteSignatureException` es consistente con que aquel gateway interpretó Bearer como firma AWS. Esto explica ese fallo de ruta, pero no demuestra que el documento existente esté o no recibido en el host corregido. La contraseña humana del script manual posterior tampoco causó el 403 original. No se necesita un adaptador fiscal nuevo: el mismo `HaciendaRecepcionAdapter` sigue presente.

La configuración instalada confirma `HACIENDA_RECEPCION_SANDBOX_BASE_URL` en el host dedicado, producción en URL inerte, `USE_REAL_HACIENDA=false`, `BILLING_SPEC09_STAG_INVOICING=false` y `EMAIL_USE_REAL=false`. Son flags leídos, no se modificaron.
