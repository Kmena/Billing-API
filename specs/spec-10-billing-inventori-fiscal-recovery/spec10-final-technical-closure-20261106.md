# SPEC-10 — cierre técnico de laboratorio y límites del corte

Corrección posterior de evidencia: la investigación real documentada en `spec10-real-sequence-archive-reconciliation-20261106.md` encontró XML firmados y archivos PDF de los números 1–4 en el almacén, aunque sus filas SQL siguen ausentes. Los PDF 1–5 no superan `pdfinfo`; el número 1 sí conserva una respuesta local de aceptación. Además, la instalación SPEC-09 usa el mismo consecutivo 1 para el mismo emisor y punto. Las afirmaciones preliminares de este informe sobre artefactos ausentes quedan sustituidas por ese informe.

Fecha: 2026-11-06. Base Billing `4b3c61c82b5fb2915979e76a8a2aca0295ae50f2`; base Afiliaciones `409b2397105f2073ab3a61166076ffb91cfb0ff3`. Ramas aisladas: `codex/spec10-final-technical-closure` y `codex/spec10-v2-auto-package`. No se actualizaron contenedores, bases ni contadores persistentes. Hacienda y SMTP no recibieron solicitudes.

## Consecutivos históricos

La consulta agregada de solo lectura del 2026-11-06 a `billing-api`/`billing-postgres` devolvió una sola dimensión: `SANDBOX/001/00001/INVOICE`, tres FE `ACCEPTED` presentes con números 5–7, máximo documental `7`, contador `lastAssigned=7, nextValue=8`. Seis reservas idempotentes figuran `COMPLETED`; tres sin documento vinculado tienen fechas que corresponden a las creaciones auditadas de los números 1–3. La auditoría registra **creación, XML y firma de los números 1–4**, pero sus filas de documento ya no están presentes. No se halló en esta consulta una explicación auditada de su retiro; se consideran consumidos y sus artefactos faltantes deben investigarse. La evidencia anterior de la base SPEC-09, tomada antes de su detención, mostraba una FE `MANUAL_REVIEW_REQUIRED` con número `1` y contador `nextValue=2`. No se arrancó esa instalación para actualizar el inventario. Para NC, ND y otros puntos no se observó una línea base persistente que certifique ausencia de uso.

La clave de reconciliación es `(identidad legal del emisor, ambiente, sucursal, terminal, tipo)`, no el UUID interno de compañía. El `8` histórico es un **piso observado**, no el próximo consecutivo autorizado. Quedan por demostrar: el valor actual de la base SPEC-09 y sus reservas, el significado de las tres reservas sin documento, cualquier ledger fiscal de Inventori o emisor externo con números no reflejados en ambos Billing, y el estado de ambas bases durante una ventana con escritores inmovilizados. Una emisión externa posterior al inventario invalida el piso. La fórmula para cada dimensión es `safe_next = max(next_value de todas las fuentes, cada número usado o reservado + 1)`, aplicada solo después de cerrar esas fuentes.

El asignador actual de Billing usa `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` dentro de la transacción del documento. La prueba HTTP con dos solicitudes Inventori v1 y dos Afiliaciones v2 concurrentes en **una** base descartable produjo cuatro números distintos y un reintento idempotente sin avance. No se tocó ningún contador instalado. La doble escritura entre las dos instalaciones sigue siendo un riesgo hasta que ambas aplicaciones apunten a una sola autoridad.

## Archivo histórico de solo lectura

Se añadió un lector **exclusivo del módulo de laboratorio**, ausente del `AppModule` productivo. La ruta v2 es `GET /api/v2/lab/companies/{companyId}/fiscal-documents/SANDBOX/historical/{sourceId}/{documentId}`; los bytes se obtienen en `.../artifacts/{SIGNED_XML|PDF|HACIENDA_RESPONSE_XML}`. Requiere asociación M2M activa y `fiscal-v2:operations:read`. El identificador combina origen y documento; el manifiesto restringe tenant, compañía y ambiente, incluye tipo, estado, clave, consecutivo y referencia FE/NC/ND. Cada lectura de artefacto verifica tamaño y SHA-256; el servicio rechaza rutas fuera del montaje y no expone rutas internas. La raíz `SPEC10_ARCHIVE_ROOT` solo se admite bajo `NODE_ENV=test`.

La prueba copió un archivo **sintético** a otra carpeta, arrancó Billing con PostgreSQL descartable, consultó por HTTP una FE, NC y ND con sus nueve artefactos, comprobó referencias, aislamiento y rechazo de un PDF adulterado. Esto demuestra el contrato y una restauración portátil de la copia sintética. No se exportaron documentos reales. La instalación histórica contiene tres FE aceptadas cuyos XML originales, PDF y respuestas ya se verificaron `MATCH` en memoria en la evidencia anterior. Los registros de auditoría 1–4 no tienen hoy documentos ni artefactos accesibles en la tabla; su ausencia es un bloqueo de conservación que exige investigación de respaldos y política de retención. La FE SPEC-09 en revisión manual no se incorporó al archivo.

Antes del acceso real se necesita un exportador/snapshot autorizado que selle metadatos y copie referencias y bytes sin modificar las fuentes; un mapa explícito entre las compañías UUID de ambos Billing basado en identidad fiscal verificada; montaje de solo lectura con permisos y custodia; restauración comprobada de ambas bases, almacenes y claves; cotejo de los 3 documentos y 9 artefactos presentes con sus SHA originales, además de resolver la ausencia de los números 1–4. La prueba sintética no acredita todavía ese corte ni la procedencia criptográfica del manifiesto real. Los originales deben permanecer consultables en su instalación hasta completar la transición.

## Entrega automática Afiliaciones v2

La API de Afiliaciones ahora solicita `POST .../invoices/{documentId}/accepted-package` al detectar `submission.status=ACCEPTED`, antes de confirmar su outbox. Billing exige `fiscal-v2:deliveries:request`, asociación, empresa, ambiente, origen y aceptación del documento y de la submission; genera o reutiliza un PDF verificado bajo bloqueo por documento, exige XML firmado, PDF y respuesta oficial íntegros, y crea una sola entrega auditable. La petición repetida devuelve la entrega existente. El correo destinatario procede del snapshot de entrega, separado de la identidad fiscal. Si faltan artefactos, la solicitud falla y no se encola el paquete. `HTTP 202` solo es recepción para procesamiento; no activa esta ruta.

El ensayo continuo Afiliaciones HTTP → pago aprobado → Billing HTTP → XML/firma → POST mock `202` → GET mock aceptado → PDF → correo mock devolvió una factura `ACCEPTED`, una sola entrega del paquete con `.pdf`, `.xml` y `_respuesta.xml`, y dos correos simulados en total (respuesta fiscal y paquete). La repetición v2 devolvió la misma entrega. El outbox Afiliaciones quedó `COMMITTED` después de solicitar el paquete. PostgreSQL de ambos servicios fue descartable; la restauración de Afiliaciones mantuvo 28 migraciones y sin deriva. No se probó SMTP real ni aceptación de Hacienda real.

## Estados y evidencia

| Control | Estado | Evidencia y límite |
| --- | --- | --- |
| `HISTORICAL_SEQUENCE_MAX_VERIFIED` | PARTIAL | Máximo observado 7 en histórico y 1 en snapshot SPEC-09; números 1–4 creados/firmados en auditoría, fuentes externas no cerradas. |
| `UNIFIED_SEQUENCE_AUTHORITY` | PARTIAL | Asignación transaccional compartida probada con v1/v2 en una base; corte persistente pendiente. |
| `HISTORICAL_ARCHIVE_RESTORE` | PASS_LAB / PARTIAL_REAL | Copia sintética restaurada y nueve artefactos verificados; falta restauración real y resolver los documentos 1–4 ausentes. |
| `HISTORICAL_ARCHIVE_ACCESS` | PASS_LAB / PARTIAL_REAL | Lectura v2 autorizada e íntegra en laboratorio; montaje/mapeo real y artefactos 1–4 pendientes. |
| `AFFILIATIONS_V2_AUTOMATIC_DELIVERY` | PASS_LAB | Outbox inicia paquete solo tras `ACCEPTED`; una entrega idempotente y completa en mock. |
| `INVENTORI_E2E_CONTINUOUS` | PASS_LAB_PREVIOUS | Recorrido v1 simulado del commit base; el lector y la ruta nuevos no cambian v1. |
| `AFFILIATIONS_E2E_CONTINUOUS` | PASS_LAB | Dos PostgreSQL descartables, aceptación y entrega simuladas. |
| `NC_ND_REGRESSION` | PASS_LAB_PREVIOUS | Suite correctiva 26/26 del commit base; la nueva ruta v2 es solo FE. |
| `SPEC10_READY_FOR_IMPLEMENTATION` | NO | Máximo histórico global, documentos auditados 1–4 ausentes, mapeo/restore real y corte único no demostrados. |

Validación de este cambio: Billing W2-B2 HTTP 20/20 con PostgreSQL descartable; Billing typecheck, lint de archivos modificados y build; Afiliaciones API/Web typecheck y lint; regresión integral SPEC-09 con POST/GET y SMTP simulados. El build de Afiliaciones requirió permiso de escritura al directorio `dist` de su worktree aislado; no se modificó Docker.

## Secuencia de instalación propuesta, sin autorización de ejecución

1. Congelar emisiones, workers y reintentos de ambos Billing. Tomar respaldos consistentes de bases, XML/PDF/respuestas, almacenes cifrados y claves; verificar restauración y huellas.
2. Reconciliar por identidad legal y dimensión todos los documentos, reservas, ledgers y numeración externa. Investigar las tres reservas sin vínculo y los cuatro documentos firmados que solo permanecen en auditoría. Si alguna fuente falta o avanza, detener el corte.
3. Sellar y montar el archivo histórico de solo lectura; probar los tres documentos reales y las referencias FE/NC/ND, sin retirar la fuente. Validar mapeo de compañías y controles de acceso.
4. Ensayar en clon el ajuste administrativo auditado del contador bajo bloqueo transaccional, sin editar documentos ni migraciones históricas. Conectar Inventori v1 y Afiliaciones v2 al mismo Billing; asegurar que el Billing antiguo quede de solo lectura antes de reabrir emisión.
5. Provisionar el nuevo scope v2 mediante rotación administrativa con solapamiento, verificar consumidor nuevo y revocar la clave vieja solo tras continuidad comprobada. Mantener SMTP y Hacienda reales apagados hasta autorizaciones separadas.
6. Ejecutar salud, concurrencia v1/v2, regresión FE/NC/ND, recuperación y cotejo de huellas; detener y recuperar desde respaldos si hay cualquier divergencia.
