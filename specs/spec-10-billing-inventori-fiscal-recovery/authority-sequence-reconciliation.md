# Autoridad de datos, consecutivos y migración divergente — SPEC-10

Fecha: 2026-11-06. Alcance: inventario **solo lectura** de `billing-postgres` (Billing histórico de Inventori) y `spec09-billing-postgres-1` (Billing SPEC-09 de Afiliaciones). No se exportaron P12, PIN, credenciales, claves privadas ni artefactos. Las comparaciones de identidad, clave y huella se hicieron en memoria; este informe solo conserva cardinalidades y coincidencias.

## Autoridad propuesta

El **código SPEC-09** es la base candidata única porque contiene v1 y v2, perfil fiscal actual, custodia, XML/firma, NC/ND de laboratorio y el adaptador Hacienda heredado de F4-S. Para **nueva emisión**, se propone la base física SPEC-09 después de la reconciliación y del corte controlado. La base histórica permanece como archivo fiscal de solo lectura con sus documentos, respuestas, PDF, XML y entregas originales. El router de lectura, si se implementa, debe usar `(instancia de origen, id de documento)`; el UUID de empresa es distinto en cada base. Esta es una propuesta de destino, no autorización de corte ni de retiro.

| Dato observado | Histórica | SPEC-09 | Decisión de conservación |
| --- | ---: | ---: | --- |
| Emisores fiscales | 1 | 1 | Misma combinación tipo/número fiscal; UUID distinto. La única entidad fiscal de prueba es esperada. |
| Claves de documento | 3 | 1 | Intersección **0**. Conservar 3 históricos aceptados y 1 SPEC-09 en `MANUAL_REVIEW_REQUIRED` sin modificar. |
| Consecutivos documentados `SANDBOX/INVOICE/001/00001` | 5, 6, 7 | 1 | Intersección **0**; ausencia de documento 2–4 en histórico no los libera. |
| Contador `last_assigned -> next_value` | 7 → 8 | 1 → 2 | Dos asignadores activos son un riesgo de colisión futura. |
| Reservas idempotentes v1 | 6 `COMPLETED`: 3 con documento, 3 sin documento | 0 v1 | Conservar todas; investigar las tres sin documento antes de cualquier importación. |
| Certificados | 7 (1 activo, 6 reemplazados) | 1 activo | Huella del activo coincide; referencias/cifrado no son intercambiables automáticamente. |
| Actividad / punto de emisión | 1 / 1 | 1 / 1 | Códigos de actividad, sucursal y terminal coinciden; no copiar IDs. |
| Vínculo consumidor | 1 integración Inventori v1; 2 claves `inventori-fiscal-v1` activas | 1 consumidor Afiliaciones, 1 asociación SANDBOX activa, 4 bindings de claves | Preservar v1 y v2; reconciliar autorización por empresa/ambiente antes del corte. |
| Envíos | 3 `ACCEPTED` | 1 `MANUAL_REVIEW_REQUIRED` | No derivar el estado fiscal de HTTP 202 ni de XML válido. |
| Artefactos | 3 XML firmados, 3 PDF, 3 respuestas Hacienda | 1 XML firmado | Conservar bytes, huellas y referencias de almacenamiento; una base sola no recupera los archivos. |
| Entregas | 6 `DELIVERED`, 8 intentos `DELIVERED` | 0 | Conservar destinatarios y acuses bajo acceso restringido; no reenviar automáticamente. |

La comparación se realizó por `identification_type + identification_number`, `clave`, `(ambiente,tipo,sucursal,terminal,sequence_value)`, huella **activa** de certificado y códigos de actividad/punto. Resultados: emisor 1/1 compartido; documento 0/3 y 0/1 compartidos; consecutivo 0/3 y 0/1 compartido; certificado activo, punto y actividad 1/1 compartidos. Esta comparación no demuestra ausencia de claves emitidas fuera de ambas bases.

## Reconciliación de consecutivos

La dimensión canónica es `(tipo de identificación fiscal, número de identificación fiscal, ambiente, sucursal, terminal, tipo de documento)`. El `company_id` interno no sirve para conciliar dos bases. Para la única dimensión observada, `SANDBOX/INVOICE/001/00001`, el próximo valor **candidato mínimo** es 8: `max(next_value histórico 8, next_value SPEC-09 2, máximo documento histórico 7 + 1, máximo documento SPEC-09 1 + 1)`. No es aún un valor aprobado para instalar. Debe incrementarse si aparecen reservas, documentos externos o movimientos posteriores al inventario.

Reglas de corte propuestas:

1. Congelar emisión, reintentos y workers de **ambas** instalaciones; capturar respaldos/restauraciones de base, artefactos y almacenes cifrados; demostrar cero operaciones en curso. La factura SPEC-09 en revisión manual sigue inmóvil.
2. Tomar instantáneas consistentes de documentos incluso anulados/sustituidos, submissions, claves, respuestas, reservas idempotentes, `fiscal_sequences`, puntos de emisión, entregas y auditoría. Comparar cardinalidad, identidad y huellas con la línea base. La consulta a Hacienda o un POST no forman parte del corte.
3. Para cada dimensión, calcular `safe_next = max(next_value de todas las fuentes, max(sequence_value documentado)+1, max(valor reservado/consumido externo)+1)`. Los huecos se conservan. Si una fuente no puede demostrar el máximo usado, **bloquear ese tipo/punto** hasta evidencia fiscal y operativa.
4. Vincular ambos consumidores a una sola autoridad de **escritura** antes de liberar la emisión. El histórico conserva solo lectura; no basta que cada base tenga una restricción única local.
5. En la autoridad, configurar el contador bajo transacción exclusiva o compare-and-swap supervisado, verificando el valor previo y el nuevo, sin alterar documentos. El asignador actual usa `INSERT ... ON CONFLICT DO UPDATE ... RETURNING last_assigned` dentro de la transacción de documento; esa serialización local sirve solo cuando existe una base escritora. Prohibir cambios concurrentes de punto y de contador durante el corte.
6. Probar dos consumidores concurrentes sobre la misma dimensión en PostgreSQL descartable: números distintos, sin salto injustificado por rollback, idempotencia estable tras rotación de clave y sin doble POST. Verificar también NC/ND por tipo con contadores separados.
7. Releer ambos ledgers inmediatamente antes de liberar tráfico. Cualquier avance respecto al snapshot invalida el cálculo y exige repetir la reconciliación.

La configuración inicial actual consulta `lastAssigned` y luego hace `upsert` de `nextValue` en operaciones separadas. Antes de usarla para un corte debe cerrarse o excluirse transaccionalmente para que no compita con la asignación atómica. La base SPEC-09 instalada ya tiene `lastAssigned=1`, por lo que su API normal rechaza reinicializar ese contador; el ajuste de corte requerirá una operación administrativa nueva, auditada y con guardas, ensayada en un clon antes de cualquier instalación. **No** se debe forzar un `UPDATE` manual sobre la base instalada.

## Migración histórica divergente

`20261103000000_fix_idempotency_api_key_rotation` figura **aplicada** una vez en el ledger histórico con checksum `0a7050dbd1bf9cd640dc43e44f00ff3880179da0f6cac5d0a2c30054160ca53a`. No está en la imagen histórica ni en la cadena SPEC-09. Un blob Git con el mismo nombre tiene otro digest y no prueba los bytes aplicados. La clasificación es: **proveniencia SQL exacta no recuperada; estado final observable y compatible para la unicidad idempotente**. No se puede afirmar que su único efecto fuera el índice.

Ambas bases muestran hoy el mismo índice único lógico `(tenant_id, company_id, operation, key)` y el índice de auditoría de `api_key_id`. Ambas tienen aplicadas `20261109000000_reconcile_fiscal_idempotency_api_key_scope` y `20261110000000_make_fiscal_idempotency_rotation_safe` con los mismos checksums. En el histórico, 24 migraciones compartidas tienen contenido SQL idéntico tras normalizar CRLF, aunque 19 checksums binarios difieren. El histórico suma 25 aplicadas; SPEC-09, 32. **No editar, inventar, renombrar ni marcar como resuelta** la migración ausente. Para la base SPEC-09 propuesta, preservar el ledger histórico en su archivo de lectura y ensayar cualquier importación de datos en restauraciones aisladas; no copiar filas de `_prisma_migrations` entre bases. Si se optara por la base histórica como autoridad física, la proveniencia faltante requeriría revisión DBA y una prueba de migración completa antes de avanzar.

La evidencia previa de ensayo de la transición idempotente está en `docs/operations/fiscal-idempotency-migration-reconciliation.md`; fue un clon descartable, no una restauración integral de ambas instalaciones. Falta ensayar el plan completo de corte con respaldos de **las dos** bases y almacenes.

## Bloqueos de implementación

- Falta una prueba restaurable de todos los artefactos y referencias históricas bajo el destino de lectura; los almacenes cifrados y sus claves son independientes.
- Falta atribuir las reservas idempotentes históricas sin documento y descartar otros consecutivos emitidos fuera de ambos ledgers.
- Falta una operación administrativa transaccional, auditada y probada para elevar el contador SPEC-09 tras inmovilizar ambas escrituras.
- Falta un router de historia o un plan equivalente para que Inventori siga consultando sus tres facturas y seis entregas al retirar la emisión histórica.
- Falta un ensayo de cortes concurrentes v1/v2 sobre la **misma** base autoridad. Ninguna imagen instalada fue alterada por este análisis.

Estado: `DATA_AUTHORITY_PROPOSED = PASS` (propuesta fundamentada); `SEQUENCE_RECONCILIATION_READY = PARTIAL` (fórmula y mínimo conocidos, corte y guardas pendientes); `HISTORICAL_DOCUMENTS_PRESERVED = PARTIAL` (observados intactos, transición sin ensayo integral); `MIGRATION_DIVERGENCE_CLASSIFIED = PARTIAL` (estado final compatible, bytes originales desconocidos).
