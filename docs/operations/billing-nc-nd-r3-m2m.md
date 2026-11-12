# W4-B-R3 — contrato M2M probado

Base real del controlador de laboratorio: `/api/v1/lab/companies/:companyId/fiscal-documents/SANDBOX`. Para NC se usa `credit-notes` y para ND `debit-notes`. La suite envió HTTP al servidor Nest con `X-API-Key` y `Idempotency-Key`; no simuló controlador, guard ni repositorio.

| Operación NC y ND | Ruta relativa | Resultado de laboratorio |
|---|---|---|
| Crear | `POST {credit-notes|debit-notes}` | 201; identidad y estado persistidos |
| Consultar por ID | `GET {tipo}/:id` | 200 con el mismo ID |
| Recuperar por clave | `GET {tipo}/by-key/:key` | 200 con el mismo ID; 409 si reserva sigue en curso |
| Preparar XML | `POST {tipo}/:id/prepare-xml` | 201, artefacto firmado y validado |

El POST recibe `sourceDocumentId`, `referenceCode` y `reason`; ND incluye líneas. NC conserva las líneas y totales del original. El original debe pertenecer a la empresa y tener estado aceptado. Los scopes `credit-notes:read/write` y `debit-notes:read/write` se verificaron con API keys reales de prueba. La respuesta a una consulta de otra empresa es 403 y una referencia ajena en la empresa autorizada es 404. Una clave sin autenticar obtiene 401.

El XML preparado pasó el XSD NC/ND v4.4 fijado, y la verificación de la firma sintética devolvió válida. No se creó ninguna fila `fiscal_submission` para la NC comprobada. Preparar XML no equivale a envío ni aceptación de Hacienda. El módulo exige `NODE_ENV=test`, no está en el entrypoint instalado y no expone operación `submit`.

**M2M: PASS_LAB. Emisión fiscal real: BLOCKED.**
