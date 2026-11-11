# BILLING-XML-44-R1 — reglas XSD y fiscales

Fuente: [FacturaElectronica.xsd oficial v4.4](https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/FacturaElectronica.xsd), SHA-256 `d384afef665573606f6499b2182d6070850ada8c93bc40fa7f0f3901a25b9cc8`; [anexos y estructuras 4.4 de Hacienda](https://www.hacienda.go.cr/docs/ANEXOS_Y_ESTRUCTURAS_V4.4.pdf). El archivo FE del repositorio es idéntico al descargado. Para TE se usó en laboratorio la copia oficial con SHA-256 `aaa273b368997d47214c92455c22b851cb5ab6ef105dc571233268c1ef5fd6c7`; los bytes del checkout Windows tenían CRLF y no coincidían con el hash fijado, por lo que se montó la copia oficial solo para validar TE. No se editó ningún XSD.

## Secuencia de `LineaDetalle`

| Elemento | Cardinalidad en FE/TE 4.4 | Valor usado y condición | Evidencia automatizada |
|---|---|---|---|
| `BaseImponible` | 1, tras `SubTotal` y antes de `Impuesto` | Subtotal exacto de la línea para IVA simple. El texto explicativo del XSD lo llama obligatorio cuando hay gravamen; su cardinalidad estructural no tiene condición. | Caso exento de una/dos líneas; rechazo por orden alterado |
| `Impuesto` | 1–1000, tras base | Un nodo para el tratamiento IVA explícito, incluso monto cero. | Casos exento, tarifa cero, 13 %, mixto |
| `CodigoTarifaIVA` | 0–1 dentro de `Impuesto` | Se exige por el serializador para códigos IVA 01/07; `10` exento, `01` 0 % con crédito, `08` 13 %. | Casos exento, 0 %, 13 %, código inválido |
| `Tarifa` | 0–1 dentro de `Impuesto` | 0 para `10` y `01`; 13 para `08` en las pruebas. | Casos positivos y rechazo de contradicción |
| `Monto` | 1 dentro de `Impuesto` | Importe decimal exacto, puede ser 0. | Casos positivos y negativos |
| `Exoneracion` | 0–1 dentro de `Impuesto` | Solo si hay respaldo fiscal y todos sus campos. El contrato actual no aporta esos datos; escenario bloqueado. | Brecha documentada, sin PASS |
| `ImpuestoAsumidoEmisorFabrica` | 1 tras `Impuesto` | 0 en los tratamientos soportados; no se implementó el régimen de fábrica. | XSD firmado de FE/TE |
| `ImpuestoNeto` | 1 tras el anterior | Igual al monto de impuesto para tratamientos soportados sin exoneración. | XSD firmado y totales |
| `MontoTotalLinea` | 1 al final | Subtotal más impuesto neto. | Casos 10000, 20000, 11300 y 21300 |

`ResumenFactura` clasifica `10` como exento y `01` como gravado a tarifa 0 % con crédito. Los grupos `TotalDesgloseImpuesto` y `TotalImpuesto` se omiten si su importe es cero; el XSD permite esas omisiones en el resumen. El código `11` (0 % sin crédito) exige un tratamiento distinto que el resumen actual no representa y se rechaza. También se rechazan montos cero con otra tarifa positiva y subtotal no nulo, así como impuestos sin código/tarifa suficientes.

El XSD oficial exige `ds:Signature` al final del documento (`minOccurs=1`, `maxOccurs=5`). Por ello un XML realmente **sin firmar no puede obtener `UNSIGNED_XSD_PASS` con el XSD íntegro**. Su validación estructural previa a la firma muestra únicamente el error de firma ausente; tras firmar, la validación XSD y la verificación criptográfica son independientes y ambas pasan. No se relajó el esquema.
