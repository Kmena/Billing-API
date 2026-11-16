# Billing W4-B-R2: nota de débito

La ND técnica de laboratorio referencia únicamente una factura `ACCEPTED` del mismo emisor, empresa y entorno `SANDBOX`. El contrato exige líneas explícitas y código/razón de referencia explícitos; no infiere una reversión de NC ni reglas comerciales de Afiliaciones. El servicio verifica el XML firmado del original antes de asignar identidad fiscal. La clave usa tipo `02`; el serializador calcula impuestos y totales con `ScaledDecimal` y agrega `InformacionReferencia` al XML `NotaDebitoElectronica` v4.4.

La identidad, la fila de auditoría durable y la clave idempotente se guardan en una transacción. Una solicitud repetida con la misma clave recupera el documento; un payload diferente obtiene conflicto. La ND queda en `XML_VALIDATED` tras firmar y validar, sin envío ni entrega. El módulo M2M existe solo para bootstrap explícito de pruebas y exige `NODE_ENV=test`/`SANDBOX`.

No se eligió tratamiento de pagos, período contable, política de reversión o código comercial de referencia. **ND: PARTIAL** hasta probar PostgreSQL descartable y M2M integral.
