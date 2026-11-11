# Billing W4-B-R2: nota de crédito

Base: `92594854f861f8343b1b4f50f722fa7177aa02a4` (`codex/billing-spec-af-w4b-r1`). Rama de trabajo: `codex/billing-spec-af-w4b-r2`.

La NC total de laboratorio toma líneas, receptor, moneda y condiciones de una factura `ACCEPTED` del mismo emisor, empresa y entorno `SANDBOX`. Antes de asignar el consecutivo, el servicio bloquea la fila original, comprueba emisor, receptor y XML firmado/verificado del original, y rechaza cualquier cambio a las líneas. La factura original permanece intacta. Un índice parcial permite como máximo una NC por original. La reserva idempotente, el consecutivo, la NC y la fila de auditoría durable se escriben en la misma transacción. La clave fiscal usa tipo `03`.

El código de referencia y la razón son obligatorios en la solicitud sintética; no hay valor predeterminado para producción. El serializador crea `NotaCreditoElectronica` con `InformacionReferencia`, totales de `ScaledDecimal` y XSD oficial v4.4 fijado en R1. La firma XAdES se reutiliza. El estado final del XML de laboratorio es `XML_VALIDATED`, sin solicitud de envío ni entrega.

`CorrectiveNotesLabModule` está excluido de `AppModule`, exige `NODE_ENV=test` y solo admite `SANDBOX`. El servicio, el envío y el adaptador Hacienda rechazan emisión real de NC. **NC: PARTIAL** hasta probar PostgreSQL descartable y M2M integral.
