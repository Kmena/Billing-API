# Reconciliación de las dos instalaciones Billing

Inventario **solo lectura** del 2026-11-06. Consultas `SELECT` agregadas a `billing-postgres` y `spec09-billing-postgres-1`; comparación de identidad, fingerprints y claves en memoria, mostrando solo booleanos/solapamientos. Se leyeron nombres de tablas, checksums de migración y SHA-256 de archivos incluidos en las imágenes. No se extrajeron P12, PIN, credenciales ni perfiles.

| Dato | Billing histórico para Inventori | Billing SPEC-09 para Afiliaciones | Interpretación |
| --- | ---: | ---: | --- |
| Empresas | 1 | 1 | Misma identidad fiscal/tipo; UUID interno distinto. Una sola entidad fiscal de pruebas es esperada y no bloquea el laboratorio. |
| Certificados | 7 registros | 1 registro | Una huella **activa** coincide; los registros históricos/rotaciones no son intercambiables por esa coincidencia. |
| Actividades / sucursales / terminales | 1 / 1 / 1 | 1 / 1 / 1 | Códigos coinciden; IDs y reglas de estado requieren mapeo posterior. |
| Facturas | 3 `SANDBOX INVOICE ACCEPTED` | 1 `SANDBOX INVOICE READY_TO_SUBMIT` con submission en revisión manual | Cero claves fiscales comunes. Preservar las cuatro; la factura SPEC-09 no se reenvía ni migra en esta fase. |
| Secuencia INVOICE, mismo ambiente/sucursal/terminal | `last_assigned=7`, `next_value=8`; documentos presentes 5–7 | `last_assigned=1`, `next_value=2`; documento presente 1 | No hay colisión documental **actual**, pero dos asignadores sobre el mismo emisor/punto crearían colisión futura. |
| Entrega/artefactos | 6 entregas, 8 intentos, 9 artefactos | 0 entregas, 0 intentos, 1 artefacto | No asumir que ACCEPTED implica entrega comprobada. |
| Migraciones aplicadas | 25 | 32 | La imagen histórica contiene 24 SQL; un identificador aplicado (`20261103000000_fix_idempotency_api_key_rotation`) no está empaquetado. SPEC-09 agrega ocho identificadores propios. |

## Checksums

Los ledgers comparten **24 nombres**. Cinco checksums binarios coinciden y 19 difieren; al quitar únicamente `CR` de los archivos de ambas imágenes, **24/24 contenidos coinciden**. En el muestreo directo, el archivo histórico con CRLF y el de SPEC-09 con LF dieron el mismo SHA-256 normalizado. Por tanto, la divergencia de esas 19 entradas es de bytes/saltos de línea, no evidencia de SQL distinto. No se deben editar checksums aplicados ni renombrar migraciones para ocultarla. Hay que verificar el ledger y la semántica de la migración histórica adicional antes de un plan de datos.

La identidad fiscal y la huella del certificado coincidentes permiten reutilizar el perfil *conceptualmente*, pero no autorizan copiar secretos ni apuntar Inventori a la base SPEC-09. La propuesta es usar el **código y capacidades de Billing SPEC-09** como futuro servicio único para emisión nueva, mantener el Billing histórico en lectura durante la transición y elegir un solo contador posterior al mayor consecutivo verificado. El destino de datos y la técnica de conservación histórica se deciden después de un ensayo de restauración y de mapear todos los documentos/artefactos. No se propone fusionar las bases en este corte.

La matriz por dimensión fiscal, las reservas sin documento y la clasificación de migración se ampliaron en `authority-sequence-reconciliation.md`. El estado de pruebas y gates está en `spec10-authority-implementation-readiness.md`.
