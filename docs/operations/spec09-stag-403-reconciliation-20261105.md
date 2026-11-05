# SPEC-09 — Reconciliación del HTTP 403 de recepción STAG

Fecha: 5 de noviembre de 2026. Alcance: inspección local de solo lectura del SANDBOX Docker persistente y documentación pública. No se creó una factura, no se repitió el POST y no se consultó ningún endpoint de Hacienda durante este diagnóstico.

## Documento existente

| Campo | Evidencia local |
| --- | --- |
| Factura Billing | `140adc48-7e4e-42bb-85bb-effe017483e2` |
| Clave | `50605112600020753025100100001010000000001110071882` |
| Consecutivo | `00100001010000000001` |
| Ambiente y estado del documento | `SANDBOX`, `READY_TO_SUBMIT` |
| Huella SHA-256 del XML firmado | `227e1ccb0f2f8abc952d46c5876e68f33c8d3aa0bb627fee35baee7dc01f5036` |
| Firma / XSD | Firma verificada localmente; XSD v4.4 `VALID`. El archivo del volumen fiscal coincide con la huella registrada. |
| Solicitud de recepción | `1430e89c-d224-4926-b8e9-54f8a1ed947a`, `MANUAL_REVIEW_REQUIRED` |
| Intentos | Un POST de recepción, `attempt_count=1`; ningún GET de reconciliación (`reconciliation_attempt_count=0`) |
| Respuesta | HTTP 403, `HACIENDA_NON_RETRYABLE_ERROR`; sin `Location`, referencia o acuse de Hacienda |
| Pago Afiliaciones | `6986a477-2ae9-4237-bded-08b0cb21ee45`, SINPE, ₡113,00, aprobado por un usuario distinto del registrador |
| Obligación / período | `4171d591-d0ae-4a0b-8c55-e2a36c8219de` / `a927a701-8a0e-4140-b2e3-a29d9922ede9` |
| Cliente Afiliaciones | `f66d0aa0-d855-4fe1-99fe-7aaa3329ba3b` |

La intención fiscal de Afiliaciones `da79c799-2eea-4f59-8d15-8a34bd12e9c9` referencia la misma factura. Sus tres transiciones locales de outbox **no** son tres POST: Billing registra un solo intento de recepción. Hay un documento, una solicitud y cero entregas de correo. No existe evidencia de aceptación ni de rechazo fiscal por Hacienda.

## Diagnóstico de autorización

La ruta construida por Billing es `https://api.comprobanteselectronicos.go.cr/recepcion-sandbox/v1/recepcion`. El IDP configurado es `https://idp.comprobanteselectronicos.go.cr/auth/realms/rut-stag/protocol/openid-connect/token`, con `client_id=api-stag`. El adaptador envía JSON con `Content-Type: application/json; charset=utf-8` y `Authorization: bearer <token>`. La [documentación pública de Hacienda](https://www.hacienda.go.cr/docs/ComprobantesElectronicosAPI.html) y el [anexo v4.4](https://www.hacienda.go.cr/docs/ANEXOS_Y_ESTRUCTURAS_V4.4.pdf) documentan la ruta STAG y el esquema Bearer. Las 120 pruebas focales del adaptador OAuth y de recepción pasaron.

En el almacén protegido, la conexión SANDBOX figura `CONNECTED` y registra autenticación OAuth previa. Sin revelar valores, se confirmó que el nombre de usuario pertenece al dominio STAG y contiene la identificación del emisor; la identidad del certificado coincide con la compañía y la asociación M2M está activa en SANDBOX. Esto **no** demuestra autorización para el recurso de recepción. La autenticación SMTP de Gmail es independiente y no interviene en el HTTP 403.

**Observación confirmada:** el cuerpo JSON del 403 contiene el mensaje de error de un analizador de encabezado `Authorization` que espera pares `key=value` de AWS Signature Version 4. El valor derivado del encabezado que venía en ese mensaje se omitió de esta evidencia. [AWS documenta ese tipo de error](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv-troubleshooting.html) para solicitudes interpretadas como SigV4.

**Inferencia:** alguna capa de acceso o enrutamiento aguas arriba interpretó el encabezado Bearer como si fuera SigV4. La causa concreta de ese enrutamiento no está probada. Puede involucrar configuración del gateway, ruta, DNS o una condición temporal. No hay variable de proxy en el contenedor. Tampoco está demostrado que al usuario fiscal le falten roles de recepción. Cambiar Billing a SigV4 contradice el contrato público consultado y no se justifica con esta evidencia.

## Consulta externa pendiente de autorización

Antes de cualquier reintento, se propone **una sola consulta de estado** de la clave existente:

1. Obtener un token efímero de STAG con las credenciales SANDBOX ya custodiadas por Billing mediante `POST https://idp.comprobanteselectronicos.go.cr/auth/realms/rut-stag/protocol/openid-connect/token`. Este POST autentica; no envía un comprobante.
2. Ejecutar exactamente un `GET https://api.comprobanteselectronicos.go.cr/recepcion-sandbox/v1/recepcion/50605112600020753025100100001010000000001110071882` con ese token.
3. Registrar solo código HTTP, estado fiscal si existe y metadatos seguros. No imprimir token, XML, credenciales ni cuerpo íntegro de error. No efectuar POST a `/recepcion`.

El [contrato de consulta de Hacienda](https://www.hacienda.go.cr/docs/ComprobantesElectronicosAPI.html) contempla `GET /recepcion/{clave}`. Un 200 permitiría reconciliar el estado. Un 404 aislado no bastaría para declarar seguro un reenvío. Un 401, 403 o el mismo error SigV4 detendría el diagnóstico remoto. **Esta consulta no se ejecutó**: requiere autorización específica del operador.

## Conservación y controles

- Recomparación de las 23 tablas fiscales con la línea base previa: 17 tablas de configuración `MATCH`. Solo cambiaron `fiscal_artifacts`, `fiscal_documents`, `fiscal_idempotency_keys_v2`, `fiscal_sequences`, `fiscal_submissions` y `fiscal_xml_artifacts`, coherentes con la factura única.
- La huella del almacén cifrado coincidió en el cierre del intento anterior; este diagnóstico no escribió en el almacén. Los respaldos anteriores y posteriores al intento permanecen fuera de Git en `D:\SPEC09-STAG-20261105-1520` y se verificó su restauración descartable en el cierre anterior.
- Billing, Afiliaciones API y ambas bases están sanos. Billing permanece con `BILLING_SPEC09_STAG_INVOICING=false`, `USE_REAL_HACIENDA=false`, `FISCAL_WORKER_ENABLE_IN_TESTS=false`, `EMAIL_USE_REAL=false`. Producción sigue bloqueada.
- No se cambió código, configuración, imagen, certificado, clave ni credencial. No hay corrección instalable demostrada aún.

## Resultado

- `STAG_403_ROOT_CAUSE = PARTIAL`: rechazo del encabezado Bearer por analizador SigV4 confirmado; motivo de enrutamiento y autorización fiscal pendientes.
- `EXISTING_INVOICE_RECONCILED = LOCAL_ONLY`: documento, firma, huella, pago e intento identificados; estado externo desconocido.
- `STAG_AUTHORIZATION_STATUS = UNVERIFIED`: OAuth previo exitoso; recepción no autorizada o mal enrutada.
- `RETRY_SAFE = NO`: no repetir POST ni crear otra factura.
- `FISCAL_CONFIGURATION_MATCH = MATCH`: 17 tablas de configuración y almacén cifrado sin cambios atribuibles a este diagnóstico.
