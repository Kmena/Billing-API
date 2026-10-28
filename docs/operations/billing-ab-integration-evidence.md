# Billing · integración final A+B · evidencia de laboratorio

**Fecha:** 2026-10-28. **Rama:** `codex/billing-ab-integration-candidate`. **Base:** `e63dbc4` (`codex/billing-w0-w3-integration-candidate`). No se modificó Inventori, `main`, una base real ni un emisor real; no hubo conexión a Hacienda, DDL objetivo, activación v2 o despliegue.

## Procedencia y compatibilidad

| Paso | Commit origen | Commit integrado | Alcance |
|---|---|---|---|
| Frente A | `53907fa` | `443d153` | Referencia correctiva íntegra, XML firmado de NC/ND accesible solo en laboratorio, OpenAPI y pruebas. |
| Frente B | `2806f18` | `4d7c148` | `billing-update`, pruebas efímeras, backup/restore y runbook STAG. |

Ambos commits descienden directamente de `e63dbc4`. Se aplicaron una vez, sin conflictos y sin duplicar commits de W0–W3. Los archivos de A y B no se superponen. `src/app.module.ts`, el snapshot de rutas v1 y `docs/contracts/fixtures/inventori-v1-route-pairs.w1-d0.json` son idénticos a la base; los 42 pares verbo/ruta de Inventori siguen protegidos. La ruta nueva `signed-xml` pertenece a `W3AFiscalLabModule`, que permanece fuera de `AppModule` y exige `NODE_ENV=test`/SANDBOX. Las modificaciones operativas de B no cambian servicios, migraciones, XML ni lógica fiscal.

## Resultados reproducidos en la rama integrada

| Validación | Comando / alcance | Resultado |
|---|---|---|
| Unidad completa, XML/XSD y firma incluidos | `npm test -- --runInBand` | 121 suites PASS, 1.375 pruebas PASS; 3 suites/13 pruebas omitidas de forma preexistente. Snapshots 2/2. |
| Contratos v1/v2 | `npm run test:w1:d0` | 11 suites, 42/42 PASS; lock de 42 pares v1. |
| E2E completo con cliente Inventori | `INVENTORI_BILLING_CLIENT_PATH` apuntó al archivo existente de lectura en `inventory-api`; `npm run test:e2e:disposable` | 30 suites, 190/190 PASS. Incluye NC/ND, XML firmado, XSD, recuperación, autorización, Inventori y flujos v1. |
| NC/ND focal | Suite `test/e2e/wave3/w3-a-corrective-lab.e2e-spec.ts` dentro del E2E completo | PASS; firma y lectura de XML, hash alterado rechazado, referencia inconsistente, notas, concurrencia y recuperación. |
| Actualización sencilla | `node --test --experimental-test-isolation=none scripts/billing-update.test.mjs scripts/billing-update.integration.test.mjs` | 9/9 PASS; Git efímero y fallos de migración, API, worker y health detienen la secuencia y se registran. |
| Migraciones y checksums | `npm run test:w0:schema` sobre PostgreSQL descartable | 27/27 aplicadas, 27/27 checksums iguales, 0 pendientes. Diff Prisma de 16 tablas: `review-required`. |
| Recuperación sintética | `verify-disposable-backup-restore.mjs` y `verify-disposable-artifacts-config.mjs` | `pg_dump`/`pg_restore` 2/2 filas iguales; SHA-256 del dump `2b4f3de1ec0e1159a903fd33b8841f6b57934a2357f193a07d455a2628f26c1c`. Dos artefactos y configuración con hashes iguales. |
| Build y tipos | `npm run build`; `npm run typecheck` | PASS / PASS. |
| Lint | `npm run lint:check` | 0 errores, 26 advertencias preexistentes. |
| Seguridad | `npm run test:safety:static`; `npm run test:safety`; `npm run test:safety:db` | PASS; 35/35 pruebas y 8/8 sobre PostgreSQL descartable. |

El E2E aplicó las 27 migraciones desde cero en un contenedor aislado y lo eliminó al terminar. Los logs de algunas pruebas negativas contienen errores esperados de integridad o fallos simulados; también hay logs tardíos de PDF tras teardown en suites históricas. Ninguna suite falló. El respaldo PostgreSQL de esta evidencia contiene solo datos sintéticos y no acredita un punto de recuperación STAG.

## Estado operativo y bloqueos reales

`sudo billing-update` queda validado como orquestador simple de laboratorio. Exige checkout `main` limpio, SHA aprobado, configuración STAG, preflight, manifiesto de backup, restore, actualización API/worker y health; registra fase y SHA. Sigue sin instalarse. Los siete ejecutores específicos de STAG, su topología, digests, montajes, health de colas, rollback y un SHA de `main` que contenga esta rama no están disponibles. Consulte el [runbook](billing-w0-w3-update-runbook.md) y el [descubrimiento B](billing-front-b-stag-readiness.md).

El ledger `_prisma_migrations` y las 16 divergencias de **la base objetivo** no se consultaron: no hay conexión autorizada. La verificación descartable no resuelve la migración histórica de procedencia incierta ni el diff Prisma. DBA debe comparar nombres, orden, estado y checksums con lectura autorizada y ensayar cualquier reconciliación sobre un restore representativo antes de DDL real.

NC/ND conserva límites fiscales explícitos: ADR-BIL-014/016 y DF-06 deben resolver elegibilidad, códigos de referencia, notas mixtas NC↔ND, versiones previas y vigencia de XSD/catálogos. La nueva comprobación de referencia debe validarse para husos horarios y originales históricos antes de uso operativo. No se infiere aceptación de Hacienda de XML/XSD/XAdES sintéticos.

## Gates y recomendación

| Gate | Estado |
|---|---|
| `BILLING_AB_INTEGRATION` | `PASS_LAB_CANDIDATE`: commits A+B incorporados una vez, sin conflicto, con regresión integrada verde. |
| `NC_ND_LAB_FUNCTIONAL` | `PASS_LAB_SYNTHETIC_LIMITED`: subconjunto NC/ND y XML/XSD/firma probado; decisiones fiscales pendientes. |
| `SIMPLE_UPDATE_LAB` | `PASS_LAB_TARGET_BLOCKED`: secuencia y fallos probados, ejecutores STAG no configurados. |
| `INVENTORI_COMPATIBILITY` | `PASS_LAB`: 42 pares v1 intactos, 42 contratos y 190 E2E con cliente leído sin modificar. |
| `DBA_TARGET_PREFLIGHT` | `BLOCKED_NO_AUTHORIZED_CONNECTION`. |
| `STAGING_READINESS` | `NOT_READY`: topología, DBA, backup/restore objetivo, ejecutores, decisiones fiscales y autorización faltantes. |
| `PRODUCTION_READINESS` | `NOT_READY`. |

**Recomendación:** conservar esta rama como candidata técnica para revisión. Preparar STAG solo mediante inventario y preflight autorizados, restore del objetivo, ejecutores de actualización y resolución fiscal; no avanzar a despliegue STAG ni producción con esta evidencia de laboratorio.
