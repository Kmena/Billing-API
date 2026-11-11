# BILLING-XML-44-R1 — causa raíz

## Trazabilidad y aislamiento

- Billing base: `3b0893fb02bbe0fb6e51ebcda795a7d1555f3820`.
- Rama de laboratorio: `codex/billing-xml-44-r1` en un worktree independiente.
- Diagnóstico anterior: Afiliaciones `f9db39a`, commit documental `a46f6ef`, estado `W2B_R1_DIAGNOSED_BLOCKED`.
- La reproducción usó el serializador y el firmador compilados de Billing base, certificado sintético, XSD 4.4 local verificado y contenedor sin red. No se usó PostgreSQL.

## Reproducción antes del cambio

| Escenario | Líneas | Total CRC | Errores XSD firmado | Firma criptográfica |
|---|---:|---:|---:|---|
| A, exento enero | 1 | 10000.00000 | 1 | válida |
| B, exento enero y febrero | 2 | 20000.00000 | 2 | válida |
| C, IVA 13 % | 1 | 11300.00000 | 0 | válida |
| D, exento e IVA 13 % | 2 | 21300.00000 | 1 | válida |

El error exacto de cada línea con impuesto cero fue: `Unexpected child with tag '{https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/facturaElectronica}MontoTotalLinea' at position 9. Tag '{https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/facturaElectronica}BaseImponible' expected.`

La condición `if (!tax.isZero())` en `appendLine` omitía `BaseImponible`, `Impuesto`, `ImpuestoAsumidoEmisorFabrica` e `ImpuestoNeto`. La firma no reparaba la estructura: el XML firmado seguía inválido pese a verificarse criptográficamente. El resumen clasificaba toda línea de impuesto cero como exenta, incluso la tarifa IVA `01` (0 % con crédito).

El XSD FE 4.4 de la rama coincide byte a byte con la copia oficial CDN, SHA-256 `d384afef665573606f6499b2182d6070850ada8c93bc40fa7f0f3901a25b9cc8`. No se cambió el XSD.
