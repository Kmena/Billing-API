# W3-B · preflight DBA de la base objetivo

**Resultado: `DBA_PREFLIGHT_BLOCKED` (2026-10-27).** No se proporcionó conexión autorizada a la base objetivo. Se comprobó solamente la presencia de configuración: `DATABASE_URL`, `DIRECT_URL` y `BILLING_TARGET_DATABASE_URL` ausentes; no hay `.env` local. No se leyeron metadatos de la base objetivo, por lo que no se afirma que tenga 27 migraciones, que sus checksums coincidan, ni que esté lista para DDL. No se ejecutó SQL sobre una base real.

## Evidencia disponible y alcance

- El [preflight SQL de solo lectura](billing-w1-d0-dba-readonly.sql) consulta `_prisma_migrations`, columnas, índices y restricciones dentro de `BEGIN TRANSACTION READ ONLY`. Debe ejecutarlo un DBA con acceso autorizado al objetivo y conservar salida sanitizada, identidad del ambiente, fecha y versión de PostgreSQL.
- El [diff W0 de 16 tablas](billing-w0-prisma-effective-diff.txt) fue obtenido de una base **descartable**, no de la base objetivo. La [clasificación por tabla](../design/billing-w1-migration-plan.md) sigue siendo la lista de revisión. No aplicar el diff mecánicamente.
- Las 27 migraciones del árbol, incluidas W1-D2, W2-B2 y W3-A, se ensayaron desde cero en PostgreSQL descartable. W3-B no añade DDL ni modifica una migración existente.

## Matriz de revisión pendiente

| Grupo de tablas del diff W0 | Riesgo para integración W1–W3 | Comprobación DBA requerida |
|---|---|---|
| `api_keys`, `companies`, `tenants` | FKs compuestas e identidad por empresa; índices sobre tablas existentes | Unicidad efectiva, cardinalidad, defaults/tipos, costo y bloqueo de crear índices; no cambiar claves v1. |
| `fiscal_documents`, `fiscal_idempotency_keys`, `fiscal_integration_associations` | Origen v2, referencia al original, índice de correcciones y reservas v1/v2 | Columnas/FKs/checks efectivos, filas v1 nulas en origen v2, unicidad y estados; ningún backfill inferido. |
| `fiscal_branches`, `fiscal_issuance_points`, `fiscal_sequences`, `fiscal_terminals` | Numeración y puntos fiscales compartidos | Nombres y definiciones de índices/FKs, alcance por empresa y ambiente; no alterar secuencias. |
| `fiscal_xml_artifacts`, `hacienda_connections` | Integridad y custodia de XML/credenciales | FKs, índices y referencias; no tocar secretos ni artefactos históricos. |
| `audit_logs`, `company_economic_activities`, `refresh_tokens`, `users` | Auditoría, cambios nominales y auth v1 | FKs/defaults/tipos e índices; clasificar diferencia nominal frente a funcional. |

## Migraciones que el DBA debe reconciliar

1. Comparar nombre, checksum, estado y orden de **cada** fila de `_prisma_migrations` objetivo con los archivos versionados; investigar migración histórica A/B y cualquier fila ajena o pendiente. No usar `migrate resolve` para ocultar una diferencia.
2. Revisar `20261114000000_w1_d2_consumer_m2m_lab`: cinco tablas M2M/idempotencia, columnas de origen en `fiscal_documents`, índices compuestos sobre `companies`/`api_keys`, FKs, checks y triggers. Medir filas, duplicados previos, bloqueos y tiempo de cada operación sobre un restore descartable del objetivo.
3. Revisar `20261115000000_w2_b2_terminal_operation_state`: ampliación de estados/check de reserva v2. Verificar estados existentes antes de aplicar.
4. Revisar `20261116000000_w3_a_corrective_lab`: enum de NC/ND, referencia y snapshot en `fiscal_documents`, FK/índice al original y check de operación. Verificar que documentos históricos v1 admitan columnas nulas y que la FK no fuerce un vínculo retroactivo.
5. Clasificar cada una de las 16 divergencias W0 con definición efectiva, impacto, responsable y decisión; confirmar o refutar el diff en el objetivo. Registrar hashes de SQL exactos y versión de Prisma/PG.

## Plan de integración condicionado

Primero, obtener preflight de solo lectura y respaldo/restore verificado. Después, ensayar migraciones exactas en restore descartable con datos representativos, medir locks, verificar índices, FKs, checks, XML y consecutivos históricos, y ejecutar contratos v1 y E2E de v2. El DBA debe aprobar una ventana y un plan de reparación hacia adelante; el rollback de aplicación desactiva v2 sin eliminar columnas, tablas ni datos. Cualquier DDL en STAG u objetivo requiere autorización separada. Hasta recibir evidencia real del objetivo, `W3_B_PRODUCTION_READINESS=NOT_READY`.
