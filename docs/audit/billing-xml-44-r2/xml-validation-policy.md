# BILLING-XML-44-R2 — política de validación XML 4.4

Base de código: `b0bef77b3d1ae4ec756855f61bfa6ac977c547c8`, rama `codex/billing-xml-44-r2`. Esta política se aplica a FE y TE de los tratamientos que Billing implementa; no constituye aceptación de Hacienda.

## Nivel A: antes de firmar

1. `FiscalDocumentService.validateCreateCommand` exige moneda, condición de venta, plazo de crédito o medio de pago, líneas y metadatos fiscales explícitos. `classifyFiscalLineTax` se comparte con el serializador. Un cero sin código/tarifa, una exención contradictoria y un IVA 13 % aritméticamente incompatible se rechazan **antes de abrir la transacción de creación**. El DTO conserva la forma v1; el rechazo ocurre en el servicio.
2. El serializador genera FE/TE con importes `ScaledDecimal` a cinco decimales. `validateUnsignedStructure` utiliza el XSD oficial **sin modificarlo**. Solo acepta que el XSD reporte exactamente un error: la ausencia de `ds:Signature` en la raíz. Cualquier otro error de elemento, tipo, orden, namespace o cardinalidad falla.
3. El mismo validador compara, en el XML sin firmar, cantidad × precio, descuentos, subtotal, base imponible para IVA 01, impuesto neto, total de línea y totales del resumen. Un XML formalmente correcto pero con base o total alterado falla con `FISCAL_XML_PRE_SIGN_AMOUNT_MISMATCH`.
4. La estructura se valida antes de cargar el XML sin firma al almacenamiento. Una falla registra el intento y el código normalizado, sin firmar ni guardar bytes de XML inválido. Los errores se auditan sin copiar XML, datos personales o secretos.

`UNSIGNED_XSD_PASS` literal no describe este nivel: el [XSD FE oficial 4.4](https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/FacturaElectronica.xsd) exige `ds:Signature` (`minOccurs=1`). El resultado correcto es `PRE_SIGN_STRUCTURE_PASS`. No se genera una firma falsa ni se relaja el XSD.

## Nivel B: documento final

Tras firmar, Billing verifica XAdES, exige que el XML firmado menos el único nodo `ds:Signature` sea exactamente el XML fiscal previo y valida el documento completo contra el XSD oficial. Una firma válida no sustituye la validación XSD. Los bytes firmados se persisten solo después de ambas verificaciones.

El timeout del proceso local XSD 1.1 pasó de 10 a 30 segundos por validación. R1 observó expiración intermitente con 10 segundos bajo carga; el límite explícito de 25 ms de la prueba negativa sigue probando el rechazo por timeout. Este cambio no afecta el timeout transaccional Prisma de W2-B.

## Esquemas fijados

| Documento | SHA-256 del archivo oficial fijado |
|---|---|
| FE | `d384afef665573606f6499b2182d6070850ada8c93bc40fa7f0f3901a25b9cc8` |
| TE | `aaa273b368997d47214c92455c22b851cb5ab6ef105dc571233268c1ef5fd6c7` |

En Windows el checkout TE presenta conversión CRLF; el laboratorio monta los bytes del blob Git con el checksum fijado. No se alteraron los XSD ni sus checksums.
