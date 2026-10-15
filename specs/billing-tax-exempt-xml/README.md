# BILLING-TAX-EXEMPT-XML — SDD de auditoría

**Estado:** defecto confirmado y corrección local implementada; liberación fiscal pendiente.
**Fecha:** 2026-10-14. **Rama:** `7-conexion_m2m`. **HEAD:** `cd1ad1da90db20f4cf3f4295b2546df619c9dcab`.

## Decisión

**`CONFIRMED_DEFECT`, severidad propuesta alta.** Con `taxAmount=0`, `taxCode=01` (IVA), `taxRateCode=10` (tarifa exenta) y `taxRate=0`, el serializador FE/TE omite `BaseImponible`, `Impuesto`, `CodigoTarifaIVA`, `ImpuestoAsumidoEmisorFabrica` e `ImpuestoNeto`. Los XML sintéticos son bien formados, pero inválidos contra los XSD v4.4 fijados en Billing. Además, el resumen trata cualquier impuesto monetario cero como exento: pierde la distinción entre exención legal, tarifa 0 %, no sujeción, exoneración y gravamen que redondea a cero.

Esto confirma un defecto estructural y de clasificación en Billing; **no demuestra rechazo de Hacienda**. No se firmó ni transmitió un documento real. La elegibilidad fiscal de una Cámara concreta para la exención del artículo 8(27) se debe resolver por separado.

## Evidencia normativa

- [Hacienda, *Anexos y Estructuras para la Emisión de Comprobantes Electrónicos*, versión 4.4, Anexo 1](https://www.hacienda.go.cr/docs/ANEXOS_Y_ESTRUCTURAS_V4.4.pdf), control de ajustes al 22/04/2026: `Impuesto {1,1000}` se describe como obligatorio para los comprobantes (p. 37); `CodigoTarifaIVA` es obligatorio con impuesto `01` o `07` (p. 38); con tarifa `10`, `Monto` debe ser `0` (p. 42). `TotalServExentos` corresponde a servicios con CAByS 5–9 y tarifa `10`, `TotalServNoSujeto` a tarifas `01` o `11`, y `TotalServExonerado` a ventas gravadas a un cliente con exoneración (p. 51). `TotalMercanciasExentas` y `TotalMercNoSujeta` aplican análogamente a CAByS 0–4 (p. 52). La nota 8.1 distingue código `01` (0 % con crédito pleno, artículo 32.1 del RLIVA), `10` (tarifa exenta, artículo 8 de Ley 9635) y `11` (0 % sin derecho a crédito para no sujeto) (p. 72). `Exoneracion` es obligatorio cuando la venta tenga exoneración (p. 44). El desglose tributario del resumen se describe en pp. 53–54.
- [Escenario oficial 7 CE de Hacienda](https://www.hacienda.go.cr/docs/Escenario7CE.pdf): para una venta legalmente exenta en factura o tiquete, indica IVA y código de tarifa `10`.
- [Ley 6826, artículo 8 inciso 27, texto de la PGR](https://www.pgrweb.go.cr/DOCS/NORMAS/1/VIGENTE/L/1980-1989/1980-1984/1982/7F0E/16282E.HTML): menciona cuotas de afiliación y mensualidades a colegios profesionales, sindicatos y cámaras empresariales. No se determinó la aplicabilidad a ninguna entidad o operación concreta.
- XSD locales: [FE](../../resources/hacienda/v4.4/FacturaElectronica.xsd), [TE](../../resources/hacienda/v4.4/TiqueteElectronico.xsd), [manifiesto](../../resources/hacienda/v4.4/manifest.json). El manifiesto identifica fuente oficial y descarga el 2026-09-12. SHA-256 comprobados: FE `d384afef665573606f6499b2182d6070850ada8c93bc40fa7f0f3901a25b9cc8`; TE `aaa273b368997d47214c92455c22b851cb5ab6ef105dc571233268c1ef5fd6c7`. Ambos XSD tienen cardinalidad mínima 1 para `BaseImponible`, `Impuesto`, `ImpuestoAsumidoEmisorFabrica` e `ImpuestoNeto` en `LineaDetalle`. La descarga remota de los XSD no se volvió a comprobar.

**Matiz normativo:** el texto explicativo del Anexo condiciona `BaseImponible` a bienes/servicios gravados, mientras que los XSD locales lo exigen también en la línea exenta ensayada. La afirmación de invalidez estructural se refiere exactamente a los XSD fijados. XSD válido no implica conformidad con todas las reglas fiscales ni aceptación de Hacienda.

## Contrato actual y ruta de datos

| Etapa | Código inspeccionado | Conducta |
| --- | --- | --- |
| Entrada HTTP | [CreateFiscalLineDto](../../src/modules/fiscal-documents/infrastructure/http/dtos/fiscal-document.dtos.ts) | `taxAmount`, `taxCode`, `taxRateCode` y `taxRate` son opcionales; no hay tratamiento explícito ni campos de exoneración. |
| Validación | [FiscalDocumentService](../../src/modules/fiscal-documents/application/fiscal-document.service.ts), `validateCreateCommand`, líneas 616–640 | Exige y valida códigos solo cuando `taxAmount != 0`. Para cero u omitido no determina el motivo. |
| Persistencia | Mismo servicio, línea 397; [Prisma](../../prisma/schema.prisma), modelo `FiscalDocument` | Pasa `command.lines` al JSON `lines`; no se ejecutó DB. El código `10` de la entrada alcanza ese punto, pero el XML lo ignora. |
| Aritmética | `calculateTotals`, líneas 761–784 | Impuesto omitido se trata como cero; total = bruto − descuento + impuesto. El importe puede cuadrar mientras el tratamiento es incorrecto. |
| Resumen XML | [Serializador v4.4](../../src/modules/fiscal-documents/infrastructure/xml/hacienda-v44-xml-serializer.adapter.ts), `computeSummary`, líneas 295–377 | `hasTax = !tax.isZero()` decide gravado/exento; no consulta tarifa. No calcula totales exonerados ni no sujetos. |
| Línea XML | Mismo serializador, `appendLine`, líneas 415–465 | Emite base, impuesto, código de tarifa y otros nodos obligatorios solo dentro de `if (!tax.isZero())`. |
| Pruebas | [Prueba del serializador](../../src/modules/fiscal-documents/infrastructure/xml/__tests__/hacienda-v44-xml-serializer.adapter.spec.ts), línea 233; [prueba Inventori P0](../../src/modules/fiscal-documents/infrastructure/xml/__tests__/inventori-p0-fiscal-compatibility.spec.ts) | La prueba de “servicio exento” verifica totales, sin XSD; las pruebas XSD existentes usan líneas gravadas. |

## Reproducción controlada

Se ejecutaron snapshots sintéticos **en memoria** con `createFiscalXmlSnapshot` y `HaciendaV44XmlSerializerAdapter`. Una línea de servicio CAByS `8313100000100`, cantidad 1 y precio 1000 salvo F. Los códigos y tarifas indicados son datos de prueba; D no constituye una exoneración real.

| Caso | DTO/snapshot tributario | XML de línea | Resumen observado | Resultado/interpretación |
| --- | --- | --- | --- | --- |
| A. IVA 13 % | `taxAmount=130`, `taxCode=01`, tarifa `08`, `taxRate=13` | `Impuesto`, `CodigoTarifaIVA=08`, `Monto=130` | `TotalServGravados=1000`, `TotalImpuesto=130`, `TotalComprobante=1130` | Control positivo. |
| B. Exento legal supuesto | `taxAmount=0`, IVA, tarifa `10`, `taxRate=0` | Sin `BaseImponible`, `Impuesto`, `CodigoTarifaIVA`, `ImpuestoAsumidoEmisorFabrica`, `ImpuestoNeto` | `TotalServExentos=1000`, `TotalExento=1000`, `TotalComprobante=1000`; sin desglose | Pierde código `10`; XSD inválido. |
| C. Tarifa 0 % con crédito | `taxAmount=0`, IVA, tarifa `01`, `taxRate=0` | Igual B | Clasificado exento | La tarifa `01` exige su propia justificación, no equivale a `10`. |
| D. Exoneración simulada | `taxAmount=0`, IVA, tarifa `08`, `taxRate=13` | Igual B; sin `Exoneracion` | Clasificado exento | El DTO carece de documento, porcentaje e importes de exoneración; esta entrada no puede representar una exoneración válida. |
| E. No sujeto | `taxAmount=0`, IVA, tarifa `11`, `taxRate=0` | Igual B | Clasificado exento, no `TotalServNoSujeto` | La tarifa `11` no equivale a `10`. |
| F. 13 % que redondea a cero | `unitPrice=0.00001`, `taxAmount=0`, IVA, tarifa `08`, `taxRate=13` | Igual B | `TotalServExentos=0.00001` | Prueba de borde; no se validó cuantía mínima fiscal. |
| G. Impuesto omitido | Sin `taxAmount` ni códigos | Igual B | Clasificado exento | La entrada no da datos para elegir tratamiento. |

No se verificó persistencia real. El código de creación pasa las líneas recibidas al campo JSON; el comportamiento XML anterior se comprobó en snapshots con los mismos campos.

Fragmento observado en B (los demás nodos de línea se omiten):

```xml
<SubTotal>1000.00000</SubTotal>
<MontoTotalLinea>1000.00000</MontoTotalLinea>
<!-- Se omitió Impuesto/CodigoTarifaIVA=10 -->
```

Como aislamiento estructural, insertar **solo en memoria** antes de `MontoTotalLinea` el fragmento siguiente hace que B pase los XSD FE y TE locales. No es una corrección de código ni prueba integral de las reglas del resumen:

```xml
<BaseImponible>1000.00000</BaseImponible>
<Impuesto><Codigo>01</Codigo><CodigoTarifaIVA>10</CodigoTarifaIVA>
  <Tarifa>0.00000</Tarifa><Monto>0.00000</Monto></Impuesto>
<ImpuestoAsumidoEmisorFabrica>0.00000</ImpuestoAsumidoEmisorFabrica>
<ImpuestoNeto>0.00000</ImpuestoNeto>
```

## Validación XSD y límites

Se compiló y aplicó `xmlschema` 4.3.2 / `XMLSchema11` directamente sobre los XSD fijados. Para satisfacer la estructura de firma XSD se anexó la firma `ds:Signature` **ficticia** usada como patrón en la prueba Inventori P0; no es firma criptográfica. Sin llamadas de red ni Hacienda.

| Documento | A (13 %) | B (código 10) | B con línea completada solo en memoria |
| --- | --- | --- | --- |
| FE | válido | inválido | válido |
| TE | válido | inválido | válido |

Para B–G en FE, el primer error XSD fue `Unexpected child ... MontoTotalLinea at position 9. Tag ... BaseImponible expected`. En TE B se observó el mismo patrón. Los XML están bien formados, pero los de impuesto cero **no validan XSD**. No se evaluaron todas las reglas tributarias ni la aceptación externa. El `Xsd11ValidatorAdapter` invocado en esta sesión de `ts-node` devolvió `FISCAL_XML_VALIDATOR_FAILED` incluso para A; se usó `xmlschema` directamente para aislar la validez XSD. Ese problema de entorno del adaptador no se diagnosticó aquí.

## Comportamiento esperado y diseño propuesto

1. Conservar en la línea el tratamiento fiscal declarado. `taxAmount=0` es un importe, no una clasificación. Para exención legal: IVA `01`, tarifa `10`, tarifa monetaria cero, importe cero y resumen exento según CAByS. La elegibilidad legal se valida fuera del serializador.
2. Para tarifa `01` o `11`, conservar código y clasificar conforme a los totales **no sujetos** del Anexo y la condición de crédito correspondiente. Una tarifa `08` cuyo importe redondea a cero sigue siendo gravada. No inventar una tarifa a partir de `taxAmount`.
3. Emitir en FE/TE los nodos obligatorios de línea aun cuando el monto de impuesto sea cero. Rechazar antes de generar XML una entrada sin metadatos suficientes; no fabricar códigos. Validar consistencia entre tarifa, base, monto y precisión decimal.
4. Calcular totales y desglose de resumen a partir de los códigos y montos declarados, respetando orden XSD y reglas del Anexo. Antes de implementar, fijar la regla de grupos de impuesto con monto cero y verificarla contra ejemplos oficiales y XSD.
5. Tratar exoneración de cliente/venta de forma separada: `Exoneracion`, impuesto neto y totales exonerados requieren ampliar contrato, persistencia y validación. No convertir exoneración a tarifa `10`.

**Corrección mínima sugerida:** cerrar temprano la ruta que genera XML inválido cuando falta metadata; para exención `10` declarada, emitir impuesto de monto cero y demás nodos requeridos. La clasificación del resumen debe usar el código de tarifa. La exoneración requiere una entrega de contrato propia.

## Waves y aceptación propuesta

| Wave | Entrega posterior | Criterios de aceptación |
| --- | --- | --- |
| 0 — decisión de contrato | Tabla de tratamientos; política para entradas históricas con cero y sin códigos; revisión fiscal | Regla aprobada; nunca se infiere exención por ausencia de datos o redondeo. |
| 1 — FE/TE | Validación temprana, serialización de cero y resumen por tratamiento | A–C y E–G probados con XSD FE/TE; B conserva `CodigoTarifaIVA=10` y `Monto=0`; C/E no aparecen exentos; G se rechaza antes de XML; A conserva importes, orden y firma. |
| 2 — exoneración | Contrato y serialización de exoneración, previa decisión normativa | D con `Exoneracion`, impuesto neto y totales propios; cobertura parcial/total, documento ausente e importes. |
| 3 — regresión transversal | Matriz de productores y bienes/servicios; sandbox Hacienda solo con autorización separada | XML sintéticos FE/TE validan XSD; sin cambios inesperados en gravados, descuentos, firma ni importes. La aceptación externa se registra aparte. |

## Compatibilidad, riesgos e impacto

- **Compatibilidad hacia atrás:** el DTO hoy admite `taxAmount` y códigos omitidos. Exigirlos puede romper clientes. Inventariar productores y datos históricos; no reinterpretar documentos firmados ni reemitirlos automáticamente. Revisar el hash/canonicalización de payload si cambia el contrato.
- **Alcance transversal:** el mismo serializador sirve FE/TE y servicios/mercancías; por ruta compartida puede afectar afiliaciones, suscripciones, servicios profesionales y productos. Es impacto potencial, no constatación de ocurrencias reales. Revisar notas fiscales futuras sin cambiarlas en esta auditoría.
- **Riesgo de regresión alto:** cambiar `!tax.isZero()` afecta línea, resumen, validación y consumidores. Probar bienes y servicios, descuentos, varias tarifas, redondeo, impuestos no IVA, FE/TE y firma antes de liberar.
- **Riesgo fiscal:** la clasificación falsa de exento puede alterar resumen y derecho a crédito; el XML cero actual falla los XSD locales. No se afirma una respuesta de Hacienda.
- **Dependencia externa:** la exención de afiliaciones bajo el artículo 8(27) y la documentación de exoneraciones requieren criterio tributario independiente.

## Cierre y siguiente paso

Auditoría documental y reproducción local completadas. No se modificaron código productivo, DTO, XSD, migraciones, Inventori ni datos. No hubo workers reales, firma real, transmisiones a Hacienda, despliegue ni commit. Revisar este SDD con responsable fiscal y dueños de los productores de Billing; una implementación y una prueba externa se autorizarían en una tarea separada.

## Implementación local posterior a la auditoría — 2026-10-14

Se conserva arriba la reproducción histórica del defecto. La implementación local en `hacienda-v44-xml-serializer.adapter.ts` clasifica por códigos declarados, no por `taxAmount != 0`; emite `BaseImponible`, `Impuesto/Codigo/CodigoTarifaIVA/Tarifa/Monto`, `ImpuestoAsumidoEmisorFabrica` e `ImpuestoNeto` también para IVA `01`/tarifa `10`/monto cero. El resumen separa servicio exento de gravado y conserva desglose de impuesto cero. `TipoTransaccion=07` se emite únicamente en FE si la línea lo trae explícitamente y es exenta; TE no lo acepta. No se infiere de monto cero ni se genera un documento de exoneración.

`FiscalDocumentService` rechaza antes de persistir líneas sin metadatos tributarios completos, combinaciones incongruentes de tarifa exenta y tipo de transacción, y tratamientos de impuesto cero no soportados. El contrato de línea agrega `transactionType` opcional en DTO, comando y JSON; la canonicalización incorpora el campo solo cuando se proporciona, conservando el hash v1 de solicitudes históricas sin él. No hubo migración. La exigencia de metadatos completos puede afectar productores antiguos que omitían impuestos: deben corregir su entrada explícita, sin reinterpretación automática. El serializador conserva pruebas de facturación gravada y rechaza los tratamientos 0 %/no sujeto/exoneración que requieren un diseño separado.

**Evidencia:** XML sintéticos FE/TE exentos validan los XSD v4.4 locales con firma ficticia. Cuatro suites enfocadas, con FE/TE y caso mixto, 64/64; regresiones de perfil, receptor, validación Inventori y preparación XML 57/57. `npm run lint:check` pasó (26 advertencias, cero errores), `npm run typecheck` y `npm run build` pasaron. La prueba de dos líneas, gravada y exenta, pasó y verificó totales separados y XSD FE. Ninguna prueba transmitió a Hacienda ni llamó al Billing real de Inventori. XSD válido no equivale a aceptación tributaria.

**Puerta pendiente:** verificar fundamento aplicable a la Cámara, CABYS concreto y momento de facturación de los períodos; usar un snapshot fiscal validado y congelado. El pago local #845 no es exento: congeló una versión gravada 13 % y está pendiente de aprobación. No hay FiscalIntent para ese pago; no se desbloqueó ninguna operación. Este cambio no autoriza emisión real.

## Decisión de integración para esta Cámara — 2026-10-14

Se registró la instrucción de tratar como `EXEMPT` las cuotas de afiliación y mensualidades de esta Cámara amparadas por el [artículo 8(27) de Ley 6826](https://www.pgrweb.go.cr/DOCS/NORMAS/1/VIGENTE/L/1980-1989/1980-1984/1982/7F0E/16282E.HTML), sujeto a comprobar que **cada concepto** es una cuota o mensualidad comprendida. `TipoTransaccion=07`, IVA `01` y tarifa exenta `10` se mantienen como representación técnica cuando corresponda. La implementación XML local no se cambió en esta decisión; no crea exoneración ni deduce el tratamiento a partir del importe cero.

El CABYS guardado en Inventori `9599900009900` se conserva. La [API oficial](https://api.hacienda.go.cr/fe/cabys?codigo=9599900009900) confirma código vigente y descripción genérica «Servicios suministrados por asociaciones, n.c.p.», referencia 13 %. La [misma API](https://api.hacienda.go.cr/fe/cabys?codigo=9511000000100) contiene un código específico «Afiliación y pagos periódicos a cámaras empresariales», referencia 0 %. Billing no sustituye códigos: la selección compatible para la línea real requiere una decisión fiscal versionada en Inventori.

El pago #845 de Inventori está `PENDING_APPROVAL`, mantiene una obligación y preparación fiscal congeladas como `TAXABLE` al 13 %, y no tiene Invoice ni FiscalIntent. No hay documento que Billing deba recuperar. Un cambio retroactivo de CABYS, IVA o versión no se aceptará como reintento de la misma identidad fiscal. La regularización depende de una decisión económica sobre los ₡50.000, de CABYS y del momento de emisión; el plan está en `specs/inventori-affiliations-memberships/22-exempt-affiliation-billing-integration.md` de Inventori. Se mantienen las pruebas XML anteriores: 64/64 enfocadas, 57/57 de regresión. Ninguna llamada real a Billing ni transmisión a Hacienda se ejecutó.
