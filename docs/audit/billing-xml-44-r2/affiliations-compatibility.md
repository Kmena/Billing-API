# BILLING-XML-44-R2 — compatibilidad con Afiliaciones

Inspección **solo lectura** del mapper W2-A en `apps/api/src/billing/affiliation-fiscal-intent.ts` y del contrato W2-B en Afiliaciones `f9db39a` (rama diagnóstica `a46f6ef`). Se compara código de referencia; no se presume que la imagen instalada tenga ese SHA. No se modificó Afiliaciones.

| Campo | Afiliaciones W2-A | Billing R2 | XML 4.4 | Resultado |
|---|---|---|---|---|
| Cliente/receptor | Tipo, identificación, nombre y correo fiscal obligatorios | DTO v1 recibe datos del receptor | FE incluye `Receptor` con tipo, identificación, nombre y correo | Compatible para FE sintética |
| Afiliación, obligación y período | UUID y fechas quedan en `fiscalSnapshot`; una línea por obligación/período | DTO v1 no acepta UUID de período | Conserva descripción y número de línea, no ID estructurado de período | Compatible con correlación local |
| N períodos | Líneas ordenadas 1..N, máximo 100; dos meses probados en W2-B-R1, marzo excluido | Acepta N líneas en una factura | N nodos `LineaDetalle`; R2 prueba dos líneas firmadas | PASS_LAB estructural |
| Base imponible | `lineTaxes[].base` declarado, positivo; base + impuesto = importe comercial | `unitPrice=base`, `quantity=1`; admite redondeo IVA 13 % a dos decimales | `BaseImponible=SubTotal` para IVA simple | Compatible en caso sintético |
| Exento | Perfil `VALIDATED_LAB`, tratamiento `LAB_EXEMPT_XML`; `tax=0` | `taxCode=01`, `taxRateCode=10`, `taxRate=0`, `taxAmount=0` | Impuesto cero explícito y resumen exento | Compatible |
| IVA 13 % | `LAB_TAXABLE_IVA_13_XML`; base × 0,13 redondeada HALF_UP a dos decimales | `01`/`08`/`13`; verifica importe exacto o redondeado | Desglose y resumen gravado 13 % | Compatible en caso sintético |
| IVA 0 % con crédito | El perfil W2-A no representa esta categoría | Admite `01`/`01`/`0` | Tarifa 0 % con resumen gravado | Brecha de Afiliaciones; no asignar código automáticamente |
| Exoneración | Sin campos de documento, institución, vigencia ni importe exonerado | DTO v1 carece de contrato completo | Requeriría `Exoneracion` y cálculo neto respaldado | `EXONERATION_CONTRACT_GAP` |
| Moneda | Solo `CRC`; USD se rechaza | DTO v1 conserva moneda | Admite CRC/USD | Compatible para CRC |
| Condición y plazo | `saleCondition=02`, `creditTermDays` entero 1–99999 | Conserva condición y plazo | `CondicionVenta=02`, `PlazoCredito`; sin medio de pago de contado | Compatible para crédito |
| Identidad comercial e idempotencia | `affiliation-invoice:{invoiceId}:v1`; solicitud, snapshot y hash locales | Encabezado v1 `Idempotency-Key`; documento con ID propio | No incorpora la clave comercial | Compatible en contrato v1 de referencia |

El origen autorizado del tratamiento fiscal es el perfil de plan `VALIDATED_LAB` junto al desglose por línea aprobado. Para incorporar IVA 0 % o exoneración en Afiliaciones se necesitarían nuevas categorías de perfil y validación de evidencia, con versión de contrato y migración aditiva del snapshot si se decide persistir esos campos; **no se implementaron**. El mayor riesgo es clasificar como exento un cero cuyo fundamento fiscal sea otro. El R2 de Billing lo rechaza si la solicitud no declara la categoría mediante código y tarifa.

W2-B conserva dependencias independientes: verificar el contrato de la imagen instalada, la política fiscal aplicable a cada plan y el timeout Prisma/P2028. Este R2 no aborda ese timeout ni reinicia W2-B.
