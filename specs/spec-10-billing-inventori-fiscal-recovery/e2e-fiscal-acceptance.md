# Prueba continua y criterios de aceptación fiscal

## Laboratorio local, sin Hacienda ni correo externo

Una corrida debe usar **dos PostgreSQL descartables independientes** y storage/secret stores sintéticos, con el Billing actual. Congelar los commits de Inventori/Afiliaciones y Billing, registrar imágenes y hashes de migración. El adaptador Hacienda es el existente `HaciendaRecepcionAdapter`, con HTTP interceptado hacia servidor local; no introducir un segundo adaptador real. El servidor de pruebas falla si detecta DNS/host de Hacienda real o producción. SMTP usa capturador local; nunca se usan credenciales instaladas.

### T1. Inventori → Billing → aceptación simulada → entrega

1. Crear cliente, factura comercial e intención fiscal sintéticos en Inventori; credencial v1 TEST enlazada a una empresa Billing sintética. Confirmar que Inventori envía `X-API-Key`, `Idempotency-Key`, correlación y snapshot fiscal inmutable.
2. Billing reserva **una** clave/consecutivo, persiste FE, produce XML 4.4, valida XSD y firma con P12 sintético. Verificar huella y que jamás salen PIN/P12 en HTTP/logs.
3. Simular OAuth `rut-stag` y capturar exactamente un POST `/recepcion/v1/recepcion`: host, Bearer, JSON, emisor/receptor y Base64 firmado. Responder **202**; exigir `POST_OUTCOME_UNKNOWN`, no ACCEPTED.
4. Simular un único GET `/recepcion/v1/recepcion/{misma clave}` con `ind-estado=aceptado`, `Mensaje=1` y respuesta XML. Exigir persistencia de ACCEPTED y respuesta; en otro caso simular `rechazado` y registrar REJECTED sin reenvío.
5. Construir PDF, XML firmado y respuesta de la **misma factura**; comprobar bytes/huellas y una entrega al SMTP capturado. Estado de entrega separado del fiscal. Repetir GET, jobs y solicitudes con la misma llave para probar cero documentos/POST/correos adicionales.
6. Reiniciar API y worker aislados entre POST y GET, y entre ACCEPTED y entrega; verificar recuperación durable sin repetición fiscal ni SMTP ambiguo.

### T2. Afiliaciones → Billing → FE simulada

En la versión actual de Afiliaciones, crear un pago con evidencia sintética, revisión por segundo usuario, intención fiscal y M2M TEST vinculado a empresa/ambiente. Verificar que onboarding y emisión tienen scopes distintos; seguir el mismo pipeline Billing de T1 y comprobar período pagado, líneas, impuestos y receptor. Repetir con empresa ajena, clave revocada y ambiente contrario. No utilizar el fixture W5 antiguo como sustituto del doble control actual.

### T3. NC y T4. ND por separado

NC total, parcial y remanente: fuente ACCEPTED sintética, referencias y saldos por línea, XML/XSD/firma, un POST/GET simulados, idempotencia y entrega capturada. ND: probar **solo** subconjunto permitido por contratos W3 y conservar bloqueo `DF_06_REFERENCE_AND_TAX_TREATMENT_PENDING` para reversión de NC y secuencias mixtas. No presentar una ND bloqueada o una validación XSD como aceptación fiscal. Exoneración general queda fuera hasta contrato y tratamiento aprobados.

## Evidencia local disponible y brecha

F4-S unitario 396/396; contratos de Inventori 37/37; Billing FE/firma/envío/entrega en tres suites PostgreSQL 30/30. La suite W3 NC/ND focal pasó **26/26** en PostgreSQL descartable. La suite W5 Afiliaciones se intentó, pero su único caso no empezó por falta de `AFILIACIONES_W5_ROOT` y segunda base descartable; no es evidencia de fracaso de facturación. Las pruebas anteriores son fragmentos, **no T1–T4 continuas**. Se observaron tareas PDF tardías tras un teardown en la corrida F3; cerrar handlers/colas forma parte del criterio de T1.

## Fase real STAG, posterior y separada

Solo tras T1–T4 locales y autorización específica para **un documento nuevo**: verificar emisor/ambiente, controles de autorización, readiness, secuencia única, receptor de prueba, endpoint dedicado, credenciales bajo Billing, auditoría y ausencia de trabajos fiscales concurrentes. Autorizar exactamente el POST, sin reintento automático; HTTP 202 o 201 solo acredita recepción técnica. Una consulta GET posterior requiere autorización y debe confirmar `ind-estado=aceptado` o `rechazado` y guardar respuesta. Entrega externa se autoriza aparte y se verifica con ID de mensaje/artefactos, sin alterar correo fiscal para dirigirla. La factura SPEC-09 en `MANUAL_REVIEW_REQUIRED` queda excluida de esta prueba.

**SPEC-10 no termina** hasta: T1 y T2 continuas; T3/T4 del alcance permitido; STAG con estado fiscal concluyente de una nueva FE autorizada; entrega verificada; secuencia única sin colisión; datos históricos íntegros. Producción mantiene gate propio.
