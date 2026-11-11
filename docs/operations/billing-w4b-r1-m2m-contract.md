# Billing W4-B-R1 — contrato M2M propuesto, inactivo

**Estado: DESIGN_ONLY.** R2 no expone rutas de NC. El motor histórico de `codex/billing-nc-nd-functional` usa un controlador `api/v2/lab/companies/:companyId/fiscal-documents/:environment/credit-notes`, con guard de consumidor v2 y scopes, pero no se puede llamar desde esta rama. No se presenta como contrato instalado.

## Contrato a aprobar e implementar

1. `POST /api/v2/lab/companies/:companyId/fiscal-documents/SANDBOX/credit-notes`: `sourceDocumentId`, modo `TOTAL`, motivo y código aprobado, identidad comercial externa; cabeceras de idempotencia y correlación. Solo emisor/empresa autorizados, original `INVOICE` aceptado con identidad, XML firmado verificable, sin NC previa no rechazada. La NC copia líneas, impuestos, moneda, receptor y total del original bajo bloqueo de fila; no acepta importes suministrados por el consumidor.
2. `GET /api/v2/lab/companies/:companyId/fiscal-documents/SANDBOX/credit-notes/:id`: estado técnico y fiscal separados, identidad, referencia original, hashes y tiempos, sin secretos.
3. Recuperación por clave y hash canónico bajo el mismo ámbito consumidor/empresa: devuelve el mismo ID fiscal ante replay; payload distinto produce conflicto. Una respuesta desconocida conserva reserva y consecutivo hasta consultar el resultado, nunca reemite.

La respuesta de creación debe distinguir `READY_FOR_XML`, XML firmado/XSD válido, `SUBMISSION_UNKNOWN`, `ACCEPTED` y `REJECTED`. `ACCEPTED` solo puede provenir del resultado fiscal del adaptador de laboratorio explícito o de Hacienda en un entorno futuro autorizado. La prueba sintética no equivale a aceptación oficial. Errores estructurados mínimos: original inexistente o ajeno, original no aceptado, referencia inválida, NC existente, clave reutilizada con payload distinto, firma/XSD fallido y resultado desconocido.

No activar POST hasta definir código/fecha de referencia y política contable, portar o adaptar el motor histórico con revisión del diff R2, agregar persistencia/migración y demostrar firma/XSD e integración. No crear rutas ND ni sustituta fiscal durante este gate.
