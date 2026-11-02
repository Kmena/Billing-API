# Frente A — descuentos, anulación TE y estabilidad XML

Base: `e62e647`. Este informe describe el contrato ejecutable, no los campos de la propuesta general. Las rutas v2 solo se registran en `NODE_ENV=test` y `SANDBOX`. Ninguna aceptación sintética acredita recepción de Hacienda.

## Matriz de descuentos

| Modalidad | v1 | v2 de laboratorio | Límite comprobado |
| --- | --- | --- | --- |
| Porcentaje por línea | No implementado | Rechazado | Solo se recibe `discountAmount` / `discounts[].amount`, como monto final; no se calcula un porcentaje. |
| Monto fijo por línea | Soportado | Soportado en laboratorio | Un monto con código oficial y naturaleza; menor o igual al bruto. |
| Varios descuentos en una línea | No implementado | Rechazado explícitamente | El XSD admite hasta cinco, pero el proyector v2 exige máximo uno. |
| Descuento global de factura | No implementado | No implementado | `TotalDescuentos` XML es suma de descuentos de líneas; no es un descuento global adicional. |
| Líneas con distintas tasas de IVA | Posible por línea; sin prueba de este frente para combinaciones generales | Solo 13 % y exento en laboratorio | Cada línea calcula su base después del descuento; otras tarifas quedan bloqueadas por política del laboratorio. |
| Concepto exento | Soportado por el motor de línea | Soportado en laboratorio | `01/10`, tasa e impuesto cero; no se infiere una exoneración. |
| TE sin receptor | Soportado por el motor documental | Soportado en laboratorio | El descuento queda en la línea del TE; receptor opcional. |
| Cantidad mayor a uno | Soportado por el motor de línea | Soportado en laboratorio | Descuento es monto total de la línea, no monto por unidad. |
| Importes decimales | Hasta cinco decimales de entrada | Hasta cinco, con producto e impuesto exactos | v2 rechaza operaciones que requieren redondeo más allá de cinco decimales. El motor v1 `ScaledDecimal.multiply` redondea; no se afirma equivalencia fiscal general sin casos adicionales. |
| FE sustituta | No hay contrato v1 de sustitución aquí | Borrador FE de laboratorio conserva el descuento | El consumidor puede editar y confirma un nuevo documento; TE sustituto sigue bloqueado. |
| NC | No se declara soporte v1 sin ruta HTTP verificada | NC FE TOTAL/PARTIAL/REMAINING y NC TE TOTAL en laboratorio | NC total copia descuento, código, naturaleza e impuesto de cada línea; fracciones que no se representan exactamente se rechazan. |
| ND | No se declara soporte de descuentos v1 | Rechazado para descuentos; TE no habilitado | Ajuste ND FE actual usa base adicional sin descuento. Reversión por DF-06 sigue bloqueada. |

## Regla fiscal y ejemplo exacto

El [anexo oficial v4.4 de Hacienda](https://www.hacienda.go.cr/docs/ANEXOS_Y_ESTRUCTURAS_V4.4.pdf) identifica TE como tipo de referencia `04`, anulación de documento como código `01`, descuento comercial como `07` y hasta cinco descuentos XML por línea. [Hacienda comunicó una actualización del anexo v4.4 en 2026](https://www.hacienda.go.cr/docs/ActualizacionAnexosyEstructurasVersion4.4CEv2.pdf); sus nuevos códigos de referencia no se habilitan en este contrato. La estructura oficial no equivale a autorización de todas las modalidades en Billing. El XSD fijado en `resources/hacienda/v4.4/NotaCreditoElectronica.xsd` se usa para validar la NC; la firma local se verifica con el motor XAdES existente. Antes de producción hace falta reconciliar el pin con la publicación oficial vigente y los tratamientos aplicables.

Ejemplo sintético CRC: línea gravada con cantidad `2`, precio `500`, bruto `1000`, descuento comercial `100`, base `900`, IVA 13 % `117`, total `1017`. Segunda línea exenta: bruto y base `500`, impuesto `0`. Comprobante y NC total: bruto `1500`, descuentos `100`, impuesto `117`, total `1517`, todo a cinco decimales. La NC referencia la clave del TE y preserva ambos tratamientos y el descuento sin recálculo porcentual.

## Investigación del fallo XML de W5B

La evidencia de Afiliaciones W5B registra un `422 FISCAL_OPERATION_TERMINAL` al preparar una FE sustituta mientras corrían build y typecheck; el mismo caso pasó aislado. El código público agrupa validación XSD y verificación de firma, de modo que **no identifica la causa**. `PrepareFiscalXmlService` guarda `lastErrorCode` en el artefacto; una próxima reproducción debe conservar `documentId`, `operationId`, ese código, errores de validación saneados y tiempos de las fases antes de atribuir la falla. Un reintento con la misma clave no debe crear una segunda FE.

Se identificó un defecto independiente y reproducible: `Xsd11ValidatorAdapter` termina el proceso Python tras 10 segundos y devuelve `FISCAL_XML_VALIDATOR_TIMEOUT` (o `FISCAL_XML_VALIDATOR_FAILED` si el motor no responde correctamente). `PrepareFiscalXmlService` clasificaba ambos como `FISCAL_XML_VALIDATION_FAILED`; `W2B2LabInvoiceService` convertía ese código en `FISCAL_OPERATION_TERMINAL`. Una interrupción del validador podía por tanto inutilizar una clave idempotente aunque el XML fuese válido. Ahora se registra `FISCAL_XML_VALIDATOR_UNAVAILABLE`, se conserva el artefacto sin marcarlo XSD inválido y la operación queda recuperable con la misma clave. Hay regresión unitaria y HTTP con fallo inducido una vez; el replay vuelve a invocar la validación real. La observación de W5B bajo carga es **compatible** con este defecto, pero no se conoce su `lastErrorCode` y no se le atribuye esta causa como hecho.

La reserva M2M y la preparación XML usan transacciones y un lease; el flujo también firma y valida fuera de la transacción. Esas dependencias siguen siendo hipótesis para el fallo W5B. La prueba HTTP de este frente ejercita NC total de TE con descuento, replay, referencia XML `04`, XSD, firma y bloqueo de TE parcial/ND. Las pruebas existentes de W2/W3 cubren concurrencia, interrupciones antes y después de asignación, firma fallida, hash conflictivo, aislamiento y FE sustituta. Sin reproducción controlada del fallo W5B, `BILLING_V2_XML_STABILITY` permanece abierto.

## Verificación y gates

La suite W3 de laboratorio pasó 26/26 pruebas HTTP sobre PostgreSQL descartable, incluidos el TE con descuento y NC descargada con SHA-256, y FE con descuento, NC total y sustituta firmada. W2-B2 pasó 16/16; documentos v1 y firma pasaron 11/11 en otro PostgreSQL descartable. Son 53 pruebas HTTP aprobadas en suites finales. Los documentos nuevos fueron firmados con certificado sintético y validados contra los XSD fijados; la aceptación del documento fuente fue estado sintético solo en la base temporal. La prueba de timeout inyecta una única interrupción del validador y en el replay invoca el validador y firmador reales. La regresión unitaria de preparación XML pasó 9/9, los contratos W2/W3 pasaron 3/3 y las regresiones de rutas/XML Inventori v1 pasaron 21/21 con su snapshot. Typecheck, build, lint de archivos tocados y parseo de los tres contratos OpenAPI pasaron. Una corrida intermedia de W3 falló por una expectativa textual del borrador (`100` frente a `100.00000`); se corrigió la aserción y la suite completa pasó. No se ejecutó DDL fuera de los contenedores temporales.

| Gate | Estado | Alcance |
| --- | --- | --- |
| `BILLING_V2_TE_CANCELLATION` | PASS_LAB | NC total TE aceptado, sin receptor, con descuento, referencia `04`, XML firmado. |
| `BILLING_V2_DISCOUNTS_FE` | PASS_LAB_LIMITED | Un monto fijo por línea, solo combinaciones tributarias sintéticas. |
| `BILLING_V2_DISCOUNTS_TE` | PASS_LAB_LIMITED | Igual que FE; TE sin receptor probado por HTTP. |
| `BILLING_V2_DISCOUNTS_CORRECTIONS` | PASS_LAB_LIMITED | NC total FE/TE conserva el monto; parcial/remaining solo FE. ND con descuento no autorizado. |
| `BILLING_V2_XML_STABILITY` | OPEN | Timeout del validador corregido y probado; causa exacta de W5B no demostrada. |
| `BILLING_V1_COMPATIBILITY` | PASS_LOCAL | Suites HTTP v1 de documentos y firma, sin contratos v1 modificados. |
| `BILLING_PRODUCTION_READINESS` | BLOCKED | V2 no registrado en producto, sin emisión a Hacienda ni validación fiscal de conceptos reales. |
