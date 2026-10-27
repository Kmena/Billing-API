# W2-B — decisión técnica de proyección fiscal sintética

**Estado:** implementado solo como laboratorio, sin aprobación formal de ADR-BIL-013/016, DP-02 ni DF-01–DF-06. Esta decisión no modifica la política de un emisor ni el contrato operativo.

## Alcance verificable

`projectW2BInvoiceLab` acepta únicamente origen confiable `SANDBOX`, `policyVersion=LAB_SYNTHETIC_V44_ONLY`, CRC, condición `01`, un medio `01` y líneas con un tributo IVA representable por el serializador actual. Los marcadores `LAB_TAXABLE_IVA_13_XML` y `LAB_EXEMPT_XML` son **patrones de XML sintético**, no clasificaciones elegibles para cuotas o un emisor. No se registran en `AppModule`. El código comercial `source` y el período quedan en la intención y el hash, pero no se copian como nodos fiscales inventados en XML. CABYS se verifica solo como estructura de 13 dígitos; su pertenencia/vigencia al catálogo requiere T07.

El adaptador proyecta a `FiscalDocumentLineInput` para reutilizar `HaciendaV44XmlSerializerAdapter`, `Xsd11ValidatorAdapter` y `NodeXadesEpesSignerAdapter`. El límite actual del motor es una entrada `Impuesto` y un descuento por línea, una forma de pago y cinco decimales para montos, tres para cantidad serializada. La proyección **rechaza** combinaciones y productos que perderían precisión; no redondea. Exoneración, referencias fiscales, moneda extranjera, crédito, precio inclusivo y casos comerciales de devengo/cobro quedan bloqueados. El XML XSD firmado prueba representabilidad, no aceptación de Hacienda.

## Canonicalización de laboratorio

`w2-b-fiscal-lab.v1` serializa en UTF-8 mediante `JSON.stringify` un objeto de propiedades en orden fijo: versión, origen confiable `(tenantId, consumerId, associationId, companyId, environment)`, intención normalizada de W2-A, totales por línea y totales consolidados. SHA-256 produce 64 caracteres hexadecimales minúsculos. Las líneas se ordenan por `lineNumber`; descuentos, impuestos y pagos conservan el orden. Los decimales se normalizan sin ceros redundantes dentro de la intención, y la proyección numérica exacta se expresa con cinco fracciones. Un campo ausente difiere de `null`; cadenas Unicode se preservan exactamente y **no** se aplica NFC/NFD. La clave idempotente no forma parte del hash, pues es la clave del namespace de W1. El `issueDate`, la clave fiscal y el consecutivo generados no forman parte del contenido de solicitud. Estas elecciones son vectores de laboratorio y no congelan `fiscal-payload.v2`.

Vector golden de dos líneas sintéticas (entrada de la prueba `w2-b-lab-projection.spec.ts`): `e1ffa2b2cea438ce00b324cc9d2a24992c9828abc78453bd38a7bd1623fd34f5`. Su snapshot se conserva junto a la prueba; cambiarlo exige revisar el orden, normalización y significado de cada campo.

La aritmética usa `bigint` con escala interna `10^5`; cantidad × precio y base × 13/100 deben ser divisibles exactamente en cinco decimales. Se rechazan residuos, importes fuera del rango del motor, bases declaradas distintas del neto, impuestos distintos del cálculo y suma de pago distinta del total. La norma v4.4 fija `SubTotal = MontoTotal − descuentos`, `MontoTotalLinea = SubTotal + ImpuestoNeto`, hasta cinco descuentos por línea y precisión Decimal 18,5 ([anexo oficial](https://www.hacienda.go.cr/docs/ANEXOS_Y_ESTRUCTURAS_V4.4.pdf), pp. 35–46). Esto verifica aritmética y estructura; no resuelve elegibilidad tributaria ni una política general de redondeo.

## Concurrencia y persistencia pendientes

Los vectores de hash usan las decisiones puras de replay y lookup W1: misma asociación/ambiente/operación/clave y mismo hash/version da replay; hash diferente da conflicto y lookup con hash diferente responde 404. La tabla W1 y sus índices ya existen en laboratorio. **No se escribe este hash de laboratorio en una reserva fiscal ni se enlaza a `FiscalDocument`**. El servicio W1 solo autoriza scopes `readiness:read` y `operations:read`; convertir esa ruta sintética en creación fiscal con un scope de lectura sería incorrecto. La reserva fiscal real necesita scope de creación aprobado, ADR-BIL-013 definitivo, asociación autorizada, operación transaccional de reserva→numeración→documento→origen y recuperación de interrupciones. Se mantiene la semántica v1, sin reutilizar su API key ni su tabla de idempotencia.

## Decisiones previas a completar W2-B

| Decisión | Estado | Efecto |
|---|---|---|
| ADR-BIL-013: snapshot, hash/version final, precisión y redondeo | Pendiente | Bloquea reserva fiscal v2, emisión y contrato operativo. |
| ADR-BIL-016 / DF-06: XSD y catálogos vigentes fijados por hash | Pendiente | Bloquea vigencia de CABYS y validación normativa de producción. |
| DP-02 / DF-01–03: granularidad, hecho fiscal, clasificación y soporte | Pendiente | Bloquea aplicar patrones sintéticos a cuotas, exenciones, pagos parciales y mixtos reales. |
| W1: scope de creación, DBA de 16 divergencias y asociación operativa | Pendiente | Bloquea persistencia documental v2 y pruebas STAG. |
