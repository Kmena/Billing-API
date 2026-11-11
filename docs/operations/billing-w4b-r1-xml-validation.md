# Billing W4-B-R1 — XML/XSD y firma

El XSD `NotaCreditoElectronica.xsd` v4.4 se tomó de la rama histórica del mismo repositorio que fijó los bytes de la [CDN oficial](https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/NotaCreditoElectronica.xsd): 118974 bytes, SHA-256 `a86a86d2f3ad85d050b85b09fd6b8d450beed76f6dcdbe60e0dfe259b3f97ef7`. El `python-xmlschema` local 4.3.2 lo compiló como XML Schema 1.1; la prueba Jest verifica tamaño, hash y compilación. No se descargó ni envió un comprobante fiscal.

El XSD de tiquete en un checkout Windows había sufrido conversión LF→CRLF aunque el blob Git conservaba el hash correcto. Se restauraron solo los bytes del blob en este worktree y se añadió una regla `.gitattributes` para impedir la conversión de XSD fijados. La prueba inicial de regresión falló por ese checksum; el rerun está registrado en `billing-w4b-r1-test-results.md`.

**XML/XSD de NC: PARTIAL.** Compilar un esquema no valida un XML de NC. No se produjo XML NC, referencia `InformacionReferencia`, firma XAdES, validación del XML firmado ni verificación de importes para NC. **Firma NC: PARTIAL** solo como preparación general existente para facturas; no se atribuye PASS a NC. El [Anexo Hacienda v4.4](https://www.hacienda.go.cr/docs/ANEXOS_Y_ESTRUCTURAS_V4.4.pdf) y el Reglamento deben guiar una revisión fiscal del código, motivo y período antes de habilitar el motor.
