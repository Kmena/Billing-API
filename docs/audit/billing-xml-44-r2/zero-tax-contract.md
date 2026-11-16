# BILLING-XML-44-R2 — contrato de metadatos fiscales

El DTO v1 mantiene `taxAmount`, `taxCode`, `taxRateCode` y `taxRate` como campos opcionales de forma. El servicio exige su presencia coherente antes de persistir una línea fiscal; omitir `taxAmount` ya no equivale a declarar cero. No se añadieron campos ni se cambió el contrato M2M.

| Tratamiento | Campos de entrada exigidos por línea | Representación XML FE/TE | Decisión |
|---|---|---|---|
| Exento explícito | `taxAmount=0`, `taxCode=01`, `taxRateCode=10`, `taxRate=0` | `BaseImponible=SubTotal`; `Impuesto/Codigo=01`, `CodigoTarifaIVA=10`, `Tarifa=0`, `Monto=0`; `ImpuestoAsumidoEmisorFabrica=0`; `ImpuestoNeto=0`; resumen exento | PASS_LAB |
| IVA 0 % con crédito | `0`, `01`, `01`, `0` | Mismos nodos obligatorios; resumen gravado a 0 % | PASS_LAB |
| IVA 13 % | `taxAmount` igual a 13 % de la base, a cinco decimales o redondeado a dos; `01`, `08`, `13` | Base, impuesto neto y desglose IVA 13 %; resumen gravado | PASS_LAB |
| IVA 4 % ya representado | `01`, `04`, `4`, importe coherente | Desglose separado por código/tarifa | Regresión de serialización, no nueva política comercial |
| Exoneración documentada | Requeriría tipo y número del documento de exoneración, institución emisora, fecha, tarifa/porcentaje e importe exonerado, enlazados a la línea | Nodo `Exoneracion` y cálculo de impuesto neto apropiado | `EXONERATION_CONTRACT_GAP` |
| Cero sin clasificación | Falta monto, código, tarifa o tasa; o tarifa positiva con cero | No se genera XML | Rechazo antes de transacción |
| IVA 0 % sin crédito, código `11` | El resumen actual no representa su clasificación fiscal distinta | No se genera XML | Bloqueado |

La base imponible de los casos IVA simples es cantidad × precio unitario menos descuentos autorizados. Los totales de línea y de `ResumenFactura` se calculan a partir de las líneas. El validador previo compara esos importes contra el XML generado y rechaza alteraciones aunque el XSD acepte su forma. Para código 08 la tasa debe ser 13 y el importe debe conciliar con la base; se admite el redondeo a dos decimales que usa el mapper sintético de Afiliaciones. No se infiere exención a partir de `taxAmount=0`.

Una extensión para exoneración debe versionar el contrato, definir el origen autorizado de cada campo y verificar la evidencia, el cálculo de impuesto neto, los totales y el almacenamiento histórico. Esta rama no implementa ni simula esa extensión. Tampoco cambia el significado fiscal de los demás códigos de impuesto o regímenes que el serializador todavía rechaza.
