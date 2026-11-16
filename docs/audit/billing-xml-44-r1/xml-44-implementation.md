# BILLING-XML-44-R1 — implementación

Base: `3b0893fb02bbe0fb6e51ebcda795a7d1555f3820`. Commit de código: `634114bc64bbfbfc248f14142cff74bc2aec79f5`. Rama: `codex/billing-xml-44-r1`.

## Archivos de producto y pruebas

- `src/modules/fiscal-documents/infrastructure/xml/hacienda-v44-xml-serializer.adapter.ts`: clasificación explícita del tratamiento fiscal, emisión de los nodos obligatorios de línea con impuesto cero y resumen que distingue exento de tarifa 0 % gravada. Se conserva `ScaledDecimal` de cinco decimales y la ruta de 13 %.
- `src/modules/fiscal-documents/infrastructure/xml/__tests__/hacienda-v44-xml-serializer.adapter.spec.ts`: dos fixtures preexistentes de línea exenta ahora contienen código/tarifa explícitos, coherentes con el documento fiscal que pretenden representar.
- `src/modules/fiscal-documents/infrastructure/xml/__tests__/billing-xml-44-r1.spec.ts`: casos FE/TE, firma XAdES sintética, validación XSD, escenarios mixtos y negativos.

## Decisiones

1. La emisión de `BaseImponible`, `Impuesto`, `ImpuestoAsumidoEmisorFabrica` e `ImpuestoNeto` se gobierna por la cardinalidad XSD de línea, no por `taxAmount > 0`.
2. Los importes cero se serializan como valores presentes. El código/tarifa IVA distingue `10` exento, `01` gravado al 0 % con crédito y `08` IVA 13 %.
3. Sin metadatos fiscales para un cero no se adivina exención; la generación falla con `FISCAL_XML_TAX_METADATA_REQUIRED`. El código `11` se rechaza hasta disponer de totales sin sujeción. La exoneración exige contrato/datos específicos y queda fuera del cambio.
4. No se alteraron DTO, rutas, autenticación M2M, almacenamiento, idempotencia, migraciones, esquemas oficiales ni lógica de Afiliaciones. El contrato de entrada conserva sus campos opcionales; solicitudes existentes con cero sin código siguen siendo admitidas por el DTO pero ya no generan un XML estructuralmente inválido: fallan de forma explícita al serializar. Esta compatibilidad funcional debe revisarse antes de adoptar el cambio.
5. El laboratorio no usó DB; validó directamente la serialización y el firmado, sin crear documentos fiscales reales.

La validación XSD estricta de un documento sin firmar sigue fallando únicamente por `ds:Signature` obligatorio. Esa limitación procede del esquema oficial, no de la corrección.
