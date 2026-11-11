# BILLING-XML-44-R1 — matriz de validación

Pruebas sintéticas sobre Billing `3b0893f` y la corrección de `codex/billing-xml-44-r1`. Contenedor `--network none`, sin DB, sin Hacienda, sin correo. Validador Python `xmlschema` contra XSD FE/TE 4.4 sin modificaciones y firma XAdES sintética.

| Escenario | Antes, errores XSD firmado | Después, errores XSD firmado | XML sin firma, XSD estricto | Firma |
|---|---:|---:|---|---|
| A. Exento, una línea ₡10000 | 1 | 0 | FAIL: solo falta `ds:Signature` | PASS |
| B. Exento, enero/febrero, dos líneas ₡20000 | 2 | 0 | FAIL: solo falta `ds:Signature` | PASS |
| C. IVA 13 %, una línea ₡11300 | 0 | 0 | FAIL: solo falta `ds:Signature` | PASS |
| D. Exento + IVA 13 %, ₡21300 | 1 | 0 | FAIL: solo falta `ds:Signature` | PASS |
| E. IVA 0 % con crédito, código `01`, ₡10000 | no incluido en reproducción base | 0 | FAIL: solo falta `ds:Signature` | PASS |
| Tiquete exento, ₡10000 | no incluido en reproducción base | 0 | FAIL: solo falta `ds:Signature` | PASS |
| Exoneración con respaldo | no reproducible | BLOCKED: faltan campos de exoneración en contrato | no evaluado | no evaluada |

Los períodos de enero y febrero se preservan en líneas separadas; no aparece marzo. El total y `BaseImponible` coinciden con el número de líneas. La estructura previa a la firma pasa todos los nodos fiscales; el único error XSD estricto es la firma obligatoria ausente. No existe resultado honesto `UNSIGNED_XSD_PASS` contra este XSD oficial: exige `ds:Signature` en la raíz.

Negativos automatizados: código fiscal ausente; tarifa ausente; código `11` sin capacidad de resumen; tarifa `99`; monto positivo con tarifa exenta; cero contradictorio con tarifa 13 %; orden de `BaseImponible`/`Impuesto` cambiado; namespace falso; monto alterado después de firmar. Los primeros casos fallan cerrados al serializar, las alteraciones de orden/namespace fallan XSD y la alteración de monto falla verificación criptográfica.

Prueba específica `billing-xml-44-r1.spec.ts`: 10/10 PASS. Los valores y recuentos anteriores provienen de la reproducción directa guardada durante la sesión de laboratorio; no contienen datos personales ni credenciales.
