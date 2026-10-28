# Billing W0–W3 · candidato de integración

**Corte:** 2026-10-28. **Rama:** `codex/billing-w0-w3-integration-candidate`, creada desde `abbbea5`. No se modificó `main`, Inventori, una base real ni un emisor real; no hubo envío a Hacienda, merge o despliegue.

## Procedencia y consolidación Git

La historia es lineal: cada wave ya es ancestro de `abbbea5`. No se hizo cherry-pick ni merge entre waves porque habría duplicado cambios. `main` local (`b6c454f`) y `origin/main` (`6b9fa8a`) son ancestros del candidato; el candidato tiene 51 commits sobre `main` local. La rama `7-conexion_m2m` del checkout principal (`9983368`) también es ancestro.

| Hito | Commit(s) heredados | Contenido |
|---|---|---|
| W0 | `e1294de` | Baseline, contrato Inventori v1, migraciones y esquema. |
| W1 | `bd18e60`, `d132fc5`, `b8764bb`, `7931071`, `ab65429`, `774a799`, `9c9723f` | Diseño, fixtures, M2M, scopes, asociaciones, reservas v2 y HTTP de laboratorio. |
| W2 | `147d662`, `ce171d3`, `8bf1b5d` | Líneas fiscales estructurales, proyección FE y persistencia/recuperación sintética. |
| W3 | `4704f97`, `abbbea5` | NC/ND de laboratorio, ledger NC, XML/XSD/XAdES y esquemas oficiales fijados. |

El checkout principal de `7-conexion_m2m` conserva modificaciones **sin commit** en el servicio/documento fiscal v1, serializador, DTO, pruebas, `nest-cli.json` y archivos nuevos de auditoría/medicina. No se copiaron ni descartaron: están fuera de la historia W0–W3 solicitada y requieren revisión separada antes de cualquier integración con ese checkout. El candidato está aislado y no sobrescribe esos archivos.

## Matriz de capacidades del candidato

La [matriz maestra C01–C54](../../billing-completion-sdd.md) conserva los 54 estados de auditoría originales. Esta tabla registra **avance técnico nuevo** sobre los grupos tocados por W0–W3; no reescribe la clasificación histórica ni confunde laboratorio con aceptación fiscal.

| Capacidades | Implementación y prueba en este candidato | Límite de integración |
|---|---|---|
| C01,C02,C04–C07,C09,C10,C28,C46,C47 | Contratos v1, aislamiento, XSD/PDF y regresión reproducible de W0; 42 pares Inventori protegidos. | No demuestra cada ruta en producción. |
| C03,C08,C11,C12,C38,C45 | Consumidores M2M, asociaciones, claves, scopes, aislamiento, rotación, reserva/lookup v2 y HTTP W1. | Módulos v2 solo en laboratorio; ADR-BIL-011/012, DP-01 y revisión DBA pendientes. |
| C13,C22,C23,C27–C31,C33,C34 | Intención fiscal de múltiples líneas, tratamiento gravado/exento sintético, precisión exacta, FE persistente y XML firmado. | Solo subconjunto W2 aprobado para pruebas; no inferir política de exoneración, 0 %, pagos múltiples o precio incluido. |
| C15,C16,C17,C33,C34 | NC total/parcial/remanente y ND por línea; referencia, hash, persistencia, consulta, recuperación, concurrencia y XML/XSD/XAdES v4.4 en laboratorio. | NC/ND fiscalmente parciales: códigos, elegibilidad, mezclas NC/ND y aceptación oficial pendientes. |
| C53 | 27 archivos de migración con checksum coincidente y ensayo desde DB vacía descartable. | 16 divergencias históricas y ledger objetivo no verificados por DBA. |
| C14,C18–C21,C24–C26,C32,C35–C37,C39–C44,C48–C52,C54 | Conservan el estado y alcance de la matriz maestra. | C54 corresponde al ledger comercial del consumidor; C37/T09 y tipos W4–W5 no se incorporan a este candidato. |

## NC/ND y compatibilidad

W3-B implementó un ledger NC por cantidades. Este candidato añade un **ledger ND estructural**: acumula base e impuesto por línea de la factura original, valida que notas previas no tengan líneas duplicadas ni impuestos incoherentes y guarda `debitLedgerBefore`/`debitLedgerAfter` en el snapshot fiscal. El cálculo usa enteros escalados y el mismo subconjunto gravado 13 %/exento 0 % de W2; no impone un límite tributario nuevo ni netea NC con ND. El bloqueo del original serializa ND concurrentes. Las secuencias mixtas NC/ND continúan rechazadas con `CORRECTION_MIXED_NOTE_POLICY_PENDING`.

`W3AFiscalLabModule` y los módulos HTTP v2 no están importados en `AppModule`; su activación requiere importación explícita en un proceso de prueba con `NODE_ENV=test`. Esta es la barrera de activación controlada actual. El OpenAPI v2 sigue marcado como laboratorio. Las rutas v1 y credenciales de Inventori no cambiaron.

## Base de datos y pruebas

El manifiesto versionado coincide con los 27 SQL de `prisma/migrations` por SHA-256. Las migraciones se aplican desde cero únicamente mediante el runner PostgreSQL descartable. Las 16 divergencias de W0 son evidencia de una base descartable histórica, no del objetivo. No había `DATABASE_URL`, `DIRECT_URL`, `BILLING_TARGET_DATABASE_URL` ni `.env` autorizado en este checkout; **`DBA_TARGET_PREFLIGHT=BLOCKED`**. El [preflight DBA](billing-w3-b-dba-preflight.md) indica las consultas de solo lectura y las verificaciones de locks, índices, FKs, defaults y checksums.

| Validación | Resultado de este candidato |
|---|---|
| Proyección NC/ND y tipos | 1.375 unitarias PASS, 13 omisiones preexistentes; `npm run typecheck` PASS. |
| Contratos OpenAPI v1/v2 | 41/41 PASS; 42 pares v1 fijados. |
| E2E NC/ND | 12/12 PASS en PostgreSQL descartable; 27 migraciones aplicadas desde base vacía. |
| E2E completa con cliente Inventori fijado | 30 suites, 186/186 PASS; 27 migraciones desde base vacía descartable. |
| Build, lint, seguridad, XSD/XAdES | Build y seguridad estática PASS; lint 0 errores y 26 advertencias preexistentes; XSD/XAdES incluidos en unidad y E2E NC/ND. |

La primera ejecución unitaria dentro del sandbox falló 40 pruebas XSD/XAdES por `FISCAL_XML_VALIDATOR_FAILED`: Node no pudo iniciar el validador Python. La misma suite completa se repitió con acceso autorizado al proceso Python y pasó 1.375/1.375 no omitidas. No se desactivó ni debilitó ninguna validación.

Las suites E2E históricas emiten algunos logs de generación PDF después del cierre de Jest y de pruebas negativas de integridad; se evalúan por resultado de suite, no como aceptación fiscal de NC/ND. Su limpieza queda como riesgo del harness antes de un gate operativo.

## Bloqueos de integración

1. ADR-BIL-011/012, DP-01 y política de claves M2M deben aprobarse formalmente antes de exponer consumidores v2 reales.
2. ADR-BIL-014/016 y DF-06 deben resolver códigos/motivos, elegibilidad de NC/ND, secuencias mixtas y la discrepancia entre anexo v4.4 y anotación del XSD NC. Una reserva `REMAINING` antes de asignación no fija todavía cantidades; esa semántica también requiere aprobación.
3. DBA debe leer el ledger objetivo, reconciliar 27 migraciones/16 divergencias y ensayar sobre restore representativo antes de cualquier DDL real.
4. STAG debe probar FE, NC y ND por escenario y emisor autorizado, con respuestas terminales; ningún resultado sintético equivale a aceptación de Hacienda.
5. No existe en este repositorio una topología productiva ni un adaptador de despliegue API/worker verificable. El [procedimiento de actualización](billing-w0-w3-update-runbook.md) delimita el script Git existente y el gate faltante para un comando de extremo a extremo.

El candidato permite revisión e integración técnica controlada. No autoriza activar v2, aplicar DDL objetivo, enviar a Hacienda, fusionar a `main` ni desplegar.

## Gates finales del corte

| Gate | Estado |
|---|---|
| `W0_W3_INTEGRATION_CANDIDATE` | `CREATED_LAB_VERIFIED`: rama única, procedencia lineal, pruebas verdes; sin PASS fiscal global. |
| `CREDIT_NOTE_FUNCTIONAL_STATUS` | `PARTIAL_LAB`: total, parcial, remanente y concurrencia verificadas; elegibilidad/códigos/aceptación pendientes. |
| `DEBIT_NOTE_FUNCTIONAL_STATUS` | `PARTIAL_LAB`: ajuste, impuesto exacto, ledger, concurrencia, XML/XSD/XAdES y recuperación verificados; política fiscal pendiente. |
| `INVENTORI_V1_COMPATIBILITY` | `PASS_LAB`: 42 pares protegidos; 41/41 contratos y 186/186 E2E con cliente fijado. |
| `DATABASE_MIGRATION_READINESS` | `PASS_DISPOSABLE_TARGET_BLOCKED`: 27 hashes y migraciones descartables; objetivo sin preflight DBA. |
| `STAGING_READINESS` | `NOT_READY`: módulos v2 solo de test, DBA y decisiones fiscales pendientes. |
| `PRODUCTION_READINESS` | `NOT_READY`: STAG, seguridad/ADR, DBA, backup/restore y autorización de release pendientes. |
