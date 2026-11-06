# SPEC-10 — reconciliación real de consecutivos y archivo histórico

Fecha: 2026-11-06. Investigación de solo lectura. No se iniciaron `spec09-billing-postgres-1`, Inventori ni Afiliaciones. No se modificaron sus volúmenes, bases, certificados o credenciales; no hubo tráfico a Hacienda ni correo. Los clones usados para inspección se ejecutaron sin red, en `tmpfs`, con los volúmenes originales montados **solo lectura**. Se descartaron al terminar.

## 1. Consecutivos históricos 1–4

La fuente viva `billing-postgres` conserva tres FE (5–7) en `ACCEPTED` y contador `last_assigned=7, next_value=8` para `SANDBOX/001/00001/INVOICE`. La auditoría conserva creación y firma de 1–4, aunque no quedan filas correspondientes en `fiscal_documents`, `fiscal_submissions`, `fiscal_xml_artifacts`, `fiscal_artifacts` ni `document_deliveries`. No se encontró en los eventos consultados una explicación de su eliminación. Seis reservas idempotentes v1 figuran `COMPLETED`; las tres sin vínculo documental corresponden temporalmente a las creaciones 1–3. El 4 tiene creación auditada sin reserva v1 conservada.

| N.º | XML actual | PDF actual | Respuesta actual | Evidencia de envío y estado local | Clasificación |
| ---: | --- | --- | --- | --- | --- |
| 1 | Presente; clave y consecutivo coinciden; XAdES verificada | Archivo presente, `pdfinfo` falla | Presente; `Mensaje=1` | Auditoría: intento HTTP 202, consulta HTTP 200 `aceptado`; Inventori `ACCEPTED` vinculado al mismo ID histórico | Enviado y aceptado **según evidencia local**; sin fila SQL actual. |
| 2 | Presente; XAdES verificada | Archivo presente, `pdfinfo` falla | Ausente | Firma y `READY_TO_SUBMIT`; no evento de solicitud de envío | Firmado; no hay evidencia de POST. |
| 3 | Presente; XAdES verificada | Archivo presente, `pdfinfo` falla | Ausente | Solicitud y reintentos técnicos, sin respuesta terminal; Inventori `ERROR_FINAL` vinculado al ID histórico | Envío no demostrado; estado fiscal inconcluso. |
| 4 | Presente; XAdES verificada | Archivo presente, `pdfinfo` falla | Ausente | Solicitud y reintentos técnicos, sin respuesta terminal | Envío no demostrado; estado fiscal inconcluso. |

Todos los números 1–4 están **consumidos** y no pueden reasignarse. La verificación XAdES usó únicamente el certificado público embebido en cada XML. La evidencia `Mensaje=1` del número 1 no sustituye una consulta oficial actual. No se reconstruyeron filas, PDF ni respuestas. Los PDF 1–5 son de 513 bytes, empiezan por `%PDF-`, carecen de `%%EOF` y `pdfinfo` los rechaza; son archivos conservados, **no PDF válidos**. Los PDF 6–7 sí pasan `pdfinfo`. La respuesta del 7 conserva bytes y huella, pero es corta y no contiene un código `<Mensaje>` numérico; su `ACCEPTED` en base no quedó corroborado por el contenido de esa respuesta. Esto exige revisión fiscal y documental antes de prometer un paquete histórico completo.

## 2. Ledger SPEC-09 y colisión

Se clonó el volumen `spec09_billing_pgdata` (65,5 MiB) con montaje de origen de solo lectura a PostgreSQL 16 en `tmpfs`, sin red. Su estado actual es una FE `SANDBOX/001/00001/INVOICE` con `sequence_value=1`, documento `READY_TO_SUBMIT`, submission `MANUAL_REVIEW_REQUIRED`, último HTTP `403`, una reserva v2 `COMMITTED` con documento, y contador `last_assigned=1, next_value=2`. Sucursal `001` y terminal `00001` están activas. No hay otros documentos ni contadores observados en ese clon.

La comparación en memoria confirmó **una identidad fiscal coincidente** entre ambos Billing. El número 1 histórico y el número 1 SPEC-09 comparten emisor, ambiente, sucursal, terminal y tipo. Sus claves fiscales de 50 dígitos son distintas. Existe, por tanto, una **colisión real de consecutivo entre instalaciones**, aunque no una colisión exacta de clave. Ningún documento debe renumerarse, reemplazarse o reenviarse para disimularla. El mínimo matemático observado para emisiones futuras sigue siendo 8, pero no se aprueba como contador de corte mientras falten fuentes y una decisión fiscal sobre la duplicación histórica.

## 3. Inventori y otras fuentes

Se clonó `inventory-api_postgres_data` (87,4 MiB) en PostgreSQL 16 sin red y sin iniciar su instalación original. Dos empresas internas de Inventori tienen la misma identidad fiscal del emisor; sus seis filas de `fiscal_sequences` para FE, NC y TE en `001/00001` permanecen `current_number=0, next_number=1`. Para esa identidad, las intenciones fiscales conservan 1 `ACCEPTED`, 3 `ERROR_FINAL` y 5–7 `ACCEPTED`. Sus IDs de documento Billing coinciden **exactamente** con la auditoría histórica. No apareció un consecutivo adicional atribuible a una emisión independiente en ese ledger local. Las referencias fiscales de compras consultadas no aportaron filas para esas empresas.

El código de Inventori consulta y configura el contador de Billing v1; el contador local de Inventori existe en su esquema, pero los valores observados no prueban emisión propia. No se inspeccionaron otros sistemas o registros externos al equipo y no se contactó Hacienda. El responsable fiscal debe aportar la lista de sistemas autorizados a emitir para esa identidad y punto, además del registro de numeración usado/reservado fuera de estas tres bases. Hasta entonces `EXTERNAL_SEQUENCE_SOURCES=PARTIAL`.

## 4. Restauración aislada del archivo real

Se restauró con `pg_restore --exit-on-error` el dump histórico `billing_dev_pre_afpr_remediation.dump` del 2026-10-07 en PostgreSQL 15 aislado, sin red, con salida correcta. SHA-256 del dump: `4ce76261b1df4bf394f2d374179d20cbd40b98b09c7db42dc3a4cd4e5ebd9418`. Contiene únicamente la FE 5 en la tabla de documentos, aunque su auditoría sí alcanza las creaciones 1–5. También se restauró en `tmpfs` el snapshot físico anterior `billing_postgres_data.tar.gz` (SHA-256 `fa2b9591bc0c168d4ae69027a8145ae4bd238d71066ac84a4411af02da12b54e`): `billing_dev` no conserva documentos y su contador marca 5→6. Los dos respaldos conocidos son posteriores a la desaparición de las filas 1–4.

El almacén instalado de artefactos se montó de solo lectura y se copió íntegro a otro `tmpfs` aislado. Los **540 archivos** coincidieron por SHA-256, con huella agregada de los inventarios ordenados `9518be54cee72045f3b2be1b0787db9c4572d44e437ca30377930ac7a96dd4dd`. En la fuente viva, XML firmado y PDF existen para 1–7; respuesta para 1 y 5–7; no hay respuesta para 2–4. Los XML 1–7 pasaron la verificación criptográfica XAdES y sus claves/consecutivos coincidieron con la auditoría y los directorios de artefactos. Para 5–7, la comprobación anterior también cotejó las huellas almacenadas en la base. Para 1–4 faltan las filas con huellas originales, de modo que el cotejo actual demuestra **igualdad con la fuente presente**, no procedencia histórica independiente de cada PDF.

El lector de archivo de laboratorio del commit `e74ebe3` exige manifiestos y asociación M2M. La copia real no incluye manifiestos verificados para 1–4 ni un mapa aprobado entre UUID de empresas. Los contratos normales de Billing no pueden consultar documentos cuyas filas ya faltan. No se publicaron estos archivos ni se crearon registros sustitutos. Por esas razones, `REAL_HISTORICAL_ARCHIVE_RECOVERY=PARTIAL`: base y bytes restaurables, pero acceso autorizado real y paquete documental completo **no demostrados**.

## 5. Procedimiento propuesto para el corte; no ejecutado

1. Identificar y bloquear ambos escritores fiscales, workers y reintentos de Inventori y Afiliaciones. Confirmar cero transacciones en curso, registrar imágenes/commits y tomar respaldos nuevos de las dos bases, los almacenes y las claves, con restauración aislada e inventarios SHA-256.
2. Obtener del responsable fiscal el ledger de todos los sistemas autorizados para el mismo emisor, ambiente y punto; resolver documentalmente la duplicación del consecutivo 1. Si el inventario externo o la decisión fiscal faltan, **detener** el corte.
3. Resolver la procedencia y disponibilidad de las filas 1–4 y los PDF inválidos 1–5. Conservar explícitamente los estados desconocidos de 2–4 y la respuesta atípica de 7. Crear un archivo de solo lectura con manifiestos sellados que distingan datos originales de metadatos reconstruidos desde auditoría; probar acceso M2M y aislamiento con copias, sin alterar las fuentes.
4. Capturar un ledger final, bajo congelamiento, por identidad fiscal, ambiente, sucursal, terminal y tipo, incluyendo documentos, auditoría, reservas, contadores y fuentes externas. Calcular `safe_next = max(next_value de cada autoridad, cada número consumido o reservado + 1)` para cada dimensión. No liberar números por ausencia de fila SQL.
5. Ensayar en clon el ajuste transaccional y auditado del contador único; exigir comprobación del valor previo y bloqueo de emisión. Desconectar la escritura histórica antes de conectar ambos consumidores al Billing único. Probar v1/v2 simultáneos, idempotencia y recuperación.
6. Releer todos los ledgers antes de reanudar. Cualquier avance, colisión nueva, pérdida de referencia o diferencia SHA exige abortar y repetir la reconciliación. Mantener el Billing histórico en solo lectura para consultas hasta que el archivo real esté probado.

## Estados

| Control | Estado | Motivo |
| --- | --- | --- |
| `HISTORICAL_SEQUENCE_1_4` | PARTIAL | Ciclo de vida clasificado y números consumidos; faltan filas 1–4 y respuesta fiscal de 2–4. |
| `SPEC09_SEQUENCE_LEDGER` | PASS_READ_ONLY | Volumen actual clonado en tmpfs; documento 1, reserva y contador verificados. |
| `EXTERNAL_SEQUENCE_SOURCES` | PARTIAL | Inventori local reconciliado; otros emisores/sistemas no descartados. |
| `REAL_HISTORICAL_ARCHIVE_RECOVERY` | PARTIAL | Dump y 540 archivos restaurados; PDF 1–5 inválidos, metadatos 1–4 ausentes, acceso M2M real pendiente. |
| `UNIFIED_COUNTER_CUTOVER_READY` | NO | Colisión real del consecutivo 1, decisión fiscal y fuentes externas pendientes. |
| `SPEC10_READY_FOR_IMPLEMENTATION` | NO | Persisten garantías críticas de numeración y archivo. |

No se repitieron pruebas sintéticas. Los controles de esta investigación fueron consultas `SELECT`, verificación XAdES con clave pública, `pdfinfo`, restauración de respaldos existentes y cotejo SHA-256 en contenedores descartables sin red.
