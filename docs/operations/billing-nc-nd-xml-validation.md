# Validación XML/XSD NC/ND v4.4

Esquemas oficiales fijados por bytes: NC `NotaCreditoElectronica.xsd` SHA-256 `a86a86d2f3ad85d050b85b09fd6b8d450beed76f6dcdbe60e0dfe259b3f97ef7` (118974 bytes); ND `NotaDebitoElectronica.xsd` SHA-256 `879b782ce33e91bdca3b7d2dc33642b51dc6b45bc8a15a85c0ee22cc594cee4a` (118992 bytes). Fuente: portal de [Anexos y Estructuras de Hacienda](https://atv.hacienda.go.cr/ATV/ComprobanteElectronico/frmAnexosyEstructuras.aspx). `.gitattributes` evita la conversión de finales de línea de XSD.

La prueba `w4b-r2-corrective-notes.spec.ts` compila ambos XSD y valida XML sin firma antes de firmar. Firma con certificado PKCS#12 sintético, verifica XAdES y valida el XML firmado contra el XSD del tipo. Resultado: NC y ND exenta, IVA 0 %, IVA 13 % y multilínea pasan (8/8); referencia ausente o malformada se rechaza. Los ejemplos usan `referenceCode=01` **solo como fixture estructural**; no deciden la política fiscal de producción.

No se afirma aceptación por Hacienda. No hubo comunicación externa.
