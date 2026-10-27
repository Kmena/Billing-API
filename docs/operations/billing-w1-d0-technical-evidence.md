# Billing W1-D0 · evidencia técnica

**Fecha:** 2026-10-27. **Base:** `codex/billing-w1-design` / `bd18e60`. **Alcance:** fixtures sintéticos, contratos propuestos, lock de 42 rutas Inventori v1, preparación del prefijo v2 y revisión DBA condicionada a acceso autorizado. ADR-BIL-011/012 y DP-01 siguen pendientes. Ningún endpoint M2M v2 operativo, reserva v2, emisor real, DDL W1, merge o despliegue fue creado.

## Cambios y trazabilidad

| Trabajo D0 | T03–T05 preparado | Evidencia ejecutable | Límite |
|---|---|---|---|
| Fixture de tenants, emisores, consumidores, asociaciones, keys y reservas sintéticos | T03 asociación y T04 namespace | `docs/contracts/fixtures/billing-consumers.v2.proposed/w1-d0-synthetic-scenarios.json` y `test/wave1/w1-d0-contracts.spec.ts` | Solo escenarios; no filas DB ni guard v2. |
| Lock de 42 pares método/ruta del cliente Inventori fijado | T03/T05 compatibilidad e aislamiento | `inventori-v1-route-pairs.w1-d0.json`, prueba de metadatos Nest y snapshot de guardas/scopes/códigos | No sustituye E2E individual de cada endpoint. |
| Prefijo v1/v2 preparado | T03/T05 routing | `configureApiPrefixes()` y prueba HTTP aislada: v1 conserva `/api/v1`, v2 explícito no recibe doble prefijo | No se registra controlador v2 en `AppModule`. |
| Matriz negativa de errores M2M | T04/T05 | 14 casos sintéticos en contrato: 401/403/404/409, rotación 200 y recuperación 202 | No prueba enforcement runtime hasta implementar T03–T05. |
| Revisión DBA | T03 DDL futuro, T04 tabla futura | SQL de solo lectura preparado y comparación W0 documentada | Base objetivo no observada por falta de conexión autorizada. |

## Resultados reproducibles

| Comando / gate | Resultado |
|---|---|
| `npm run test:w1:d0 -- --silent` | **4 suites, 29/29**: tres contratos v1, contrato/14 escenarios negativos propuestos v2 y gate de SQL solo lectura. |
| `npm test -- --runInBand --silent` | 114 suites aprobadas, 3 omitidas; **1.302 pruebas aprobadas, 13 omitidas, 0 fallidas**. Las omisiones son las mismas condiciones DB/SSM de W0. |
| `npm run typecheck`; lint de archivos W1-D0; `npm run test:safety:static` | PASS. |
| `npm run test:safety`; `npm run test:safety:db` | **35/35** y **8/8**, DB etiquetada descartable. |
| `npm run test:e2e:disposable` con cliente Inventori fijado | **26 suites, 153/153** en PostgreSQL descartable; 0 fallidas. |
| `npm run test:db-regression:disposable`; `npm run test:w0:localstack` | **12/12** PostgreSQL descartable; **1/1** SSM LocalStack efímero. Las 13 omisiones unitarias se ejecutaron por separado. |
| `npm run build`; `npm run lint:check` | PASS. Lint global informó 26 warnings `no-explicit-any` en archivos preexistentes; 0 errores y 0 warnings en archivos W1-D0. |

El cliente Inventori se extrajo byte a byte de `edb1e05186d296e3699c71306913f16aee470d1e:inventory-api/src/services/billing-api-client.service.js`; SHA-256 `1bc069fa657569ce3c489b633775adea8ba362bbe3c3f19e0051209c88ea9da0`. Se asignó `INVENTORI_BILLING_CLIENT_PATH` a una copia temporal para E2E. La prueba de prefijo usa controladores de prueba únicamente; no invoca pipeline fiscal.

### Repetición local

```powershell
npm run test:w1:d0 -- --silent
npm test -- --runInBand --silent
npm run typecheck
npm run test:safety:static
npm run test:safety
npm run test:safety:db
npm run test:db-regression:disposable
npm run test:w0:localstack
# Para E2E: extraer el blob Inventori fijado arriba a un archivo temporal,
# asignar su ruta a INVENTORI_BILLING_CLIENT_PATH y ejecutar:
npm run test:e2e:disposable
```

Los comandos `*:disposable` aplican historia existente únicamente dentro de contenedores PostgreSQL etiquetados, efímeros y protegidos por el harness W0. No se añadió ni ejecutó migración W1.

## Revisión de esquema: esperado frente a observado

| Punto | Esperado | Observado en evidencia disponible | Estado |
|---|---|---|---|
| Historia en base descartable W0 | 24 migraciones históricas y checksums exactos | W0: 24/24, cero pendientes. El E2E D0 repitió esa historia en contenedor descartable. | Verificado solo para descartable. |
| Datamodel Prisma frente a SQL histórico | Concordancia antes de nuevos DDL | W0 documentó divergencias en **16 tablas**: defaults/tipos de tiempo, FKs e índices. W1-D0 no cambió `schema.prisma` ni `prisma/migrations`. | Divergencia previa no reparada; detalle en `billing-w0-prisma-effective-diff.txt`. |
| Nuevos modelos W1 | Ausentes hasta ADR-BIL-011/012 y migración revisada | No se agregaron modelos ni migraciones W1. | Como se esperaba para D0. |
| Base objetivo | Lectura autorizada de `_prisma_migrations`, columnas, índices y FKs | No hay `DATABASE_URL`, `DIRECT_URL` ni `.env` en este worktree. No se conectó a base normal o productiva. | **No observado**; requiere acceso DBA autorizado. |

Las consultas preparadas en [billing-w1-d0-dba-readonly.sql](billing-w1-d0-dba-readonly.sql) usan una transacción `READ ONLY` y solo metadatos. **No se ejecutaron**: disponer de un archivo SQL no confiere autorización sobre una base objetivo. El plan de clasificación de las 16 tablas y gates de DDL sigue en [plan W1 DBA](../design/billing-w1-migration-plan.md). La migración histórica A de bytes no recuperados y B históricamente pendiente se registran como antecedente, no como estado actual confirmado.

Las 16 tablas del diff W0 son `api_keys`, `audit_logs`, `companies`, `company_economic_activities`, `fiscal_branches`, `fiscal_documents`, `fiscal_idempotency_keys`, `fiscal_integration_associations`, `fiscal_issuance_points`, `fiscal_sequences`, `fiscal_terminals`, `fiscal_xml_artifacts`, `hacienda_connections`, `refresh_tokens`, `tenants` y `users`. W1-D0 no alteró su esquema; el estado de cada una en la base objetivo sigue **NO OBSERVADO**.

## Riesgos residuales y cierre

- El snapshot de 42 rutas protege metadatos de rutas, guards, scopes y códigos HTTP, más el E2E real fijado; no prueba cada combinación de cuerpo/respuesta por separado.
- Las negativas v2 y el namespace idempotente son **expectativas de contrato**. Su autorización y persistencia reales corresponden a T03–T05 después de ADR-BIL-011/012 y DP-01.
- El prefijo v2 fue probado en una app Nest mínima; `AppModule` de Billing todavía no publica operaciones v2.
- Sin lectura de la base objetivo, no se afirma que sus migraciones o las 16 divergencias tengan el mismo estado que la base descartable.

**Estado D0: `W1_D0_TECHNICAL_PASS` local.** Los criterios aplicables de D0 pasaron en fixtures, contratos, routing, v1, seguridad y E2E descartable. La lectura de la base objetivo estaba condicionada a acceso autorizado y queda pendiente; este estado no acredita T03–T05 operativos, STAG ni producción. No iniciar W1-D1 automáticamente.
