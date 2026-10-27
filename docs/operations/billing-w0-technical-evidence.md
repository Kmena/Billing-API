# Billing W0 · evidencia de cierre técnico

Fecha: 2026-10-27. Rama aislada `codex/billing-w0`, base `9983368dd255e36438295e63a5a3be53a8308996`. El checkout original conserva cambios fiscales locales de otro trabajo; no se copiaron al worktree W0. Por eso el conteo auditado de **1.307 aprobadas, 13 omitidas, 0 fallidas** corresponde al árbol original de la auditoría, mientras esta rama limpia tiene su propia línea base. Los resultados de ambos árboles no se mezclan ni se presentan como el mismo commit.

| Gate en la rama W0 | Resultado |
|---|---|
| `npm test -- --runInBand --silent` final, sin suites pesadas concurrentes | 112 suites aprobadas, 3 omitidas; **1.297 pruebas aprobadas, 13 omitidas, 0 fallidas** |
| `npm run test:e2e:disposable` con cliente Inventori fijado | **26 suites, 153 pruebas aprobadas, 0 fallidas** |
| `npm run test:db-regression:disposable` | **12/12** pruebas F3/F4 aprobadas |
| `npm run test:w0:localstack` | **1/1** prueba SSM aprobada en contenedor efímero |
| `npm run test:safety` y `npm run test:safety:db` | **35/35** y **8/8** aprobadas |
| `npm run test:safety:static`, typecheck, Prisma validate y lint de archivos W0 | PASS |

La rama W0 contiene 10 pruebas ejecutadas menos que el conteo previo del árbol original, pese a añadir pruebas nuevas: el checkout original tenía cambios y pruebas fiscales locales ajenos a W0. Esta diferencia de árboles es una limitación de comparabilidad, no una omisión silenciosa de Jest. Una primera pasada con varias suites pesadas simultáneas tuvo un test HTTP de readiness fallido; aislado pasó 32/32 y la repetición unitaria completa secuencial cerró sin fallas.

## T00 · pruebas

Runner local: Node `24.16.0`, npm `11.13.0`, Python `3.14.5` con `xmlschema 4.3.2`; CI fija Node 24 y Python 3.12 e instala `xsd11/requirements.txt`. Docker Engine `27.3.1` y la imagen `postgres:15-alpine` se usaron para las suites descartables. La instalación local se hizo con `npm ci --offline` (997 paquetes, 0 vulnerabilidades reportadas por npm en esa ejecución). `npx tsc --noEmit --incremental false`, `npx prisma validate` con URL ficticia sin conexión y las suites focales XSD/PDF pasaron.

La primera repetición en HEAD limpio reveló que Windows extraía `TiqueteElectronico.xsd` con CRLF: SHA-256 de trabajo `cda1c7dd97f9a235111c29948f05d7893864663cd73792fd3b51e3dae582cfdb`, distinto del hash fijado `aaa273b368997d47214c92455c22b851cb5ab6ef105dc571233268c1ef5fd6c7`. Los bytes Git LF coincidían exactamente con el hash fijado; se impuso LF en `.gitattributes` para XSD y SQL de migración. No se alteró el XSD ni se redujo la validación. El test de autorización heredado tenía una línea sin metadatos tributarios obligatorios; el fixture ahora incluye IVA explícito para llegar a la autorización que el test pretende evaluar. El E2E de recuperación usaba `createdAt` fijo del 2026-10-11 junto al reloj actual y quedaba fuera de su ventana de 72 horas; solo ese fixture usa ahora la fecha real del intento.

Las 13 omisiones de `npm test` tienen causas precisas: 2 pruebas F3 PostgreSQL y 10 F4 PostgreSQL requieren `RUN_DB_TESTS=1` y una base marcada como descartable; 1 prueba de persistencia SSM requiere `AWS_SSM_ENDPOINT` de LocalStack. No se cambió ningún `describe.skip` ni se excluyó una suite. F3/F4 pasaron 12/12 mediante `npm run test:db-regression:disposable`. La prueba SSM se ejecuta separadamente con `npm run test:w0:localstack` usando un contenedor efímero marcado y puerto loopback.

La auditoría anterior clasificó 43 fallas del runner restringido: 35 por `spawnSync python EPERM` y 8 por `EPERM` al escribir `test-output/pdf`; al repetir el mismo árbol fuera de esa restricción pasaron 1.307/1.307 ejecutadas. W0 añadió otra causa distinta, los finales de línea del XSD en un checkout limpio Windows, y la corrigió sin cambiar el esquema fiscal. Las 13 pruebas omitidas por defecto se ejecutaron por separado: 12 en PostgreSQL descartable y una en LocalStack efímero, todas PASS.

## T01 · compatibilidad v1

`docs/contracts/inventori-v1-inventory-w0.md` lista 42 pares verbo/ruta del cliente Inventori fijado por CI en `edb1e05186d296e3699c71306913f16aee470d1e`, su hash de fuente y hashes OpenAPI. La prueba `inventori-v1-route-contract.spec.ts` fija perfil `inventori-fiscal-v1`, verbos, rutas, guardas y scopes de nueve rutas principales. Siguen vigentes los golden fixtures y tests de equivalencia fiscal, lookup y onboarding. El E2E de onboarding con el cliente real fijado pasó dentro de la suite descartable completa. La coexistencia `/api/v1` + `/api/v2` queda preparada como regla contractual; W0 no introdujo rutas v2 ni cambió respuestas o permisos v1.

## T02 · esquema

`billing-w0-schema-reconciliation.md` y `billing-w0-migration-manifest.json` registran orden y hash de las 24 migraciones. `npm run test:w0:schema` verificó en un PostgreSQL efímero 24/24 checksums, cero pendientes, índice lógico de idempotencia y columna de auditoría. El diff completo con el datamodel está en `billing-w0-prisma-effective-diff.txt`: Prisma propone diferencias en 16 tablas, principalmente defaults, tipos de tiempo, FKs y nombres de índices. Requiere revisión DBA antes de cualquier DDL real. El estado actual de la base normal no se leyó; el antecedente histórico de la migración A irrecuperable y B pendiente se conserva como antecedente, no como hecho actualizado.

## Comandos reproducibles

```powershell
npm ci
python -m pip install -r src/modules/fiscal-documents/infrastructure/xml/xsd11/requirements.txt
npx prisma generate
$env:DATABASE_URL='postgresql://w0:w0@127.0.0.1:1/w0_no_connect'
npx prisma validate
Remove-Item Env:DATABASE_URL
npx tsc --noEmit --incremental false
npm test -- --runInBand --silent
npm run test:safety:static
npm run test:safety
npm run test:safety:db
npm run test:db-regression:disposable
npm run test:w0:schema
npm run test:w0:localstack
```

Para E2E, obtener el cliente del commit fijado por CI en una ruta temporal, asignarla a `INVENTORI_BILLING_CLIENT_PATH` y ejecutar `npm run test:e2e:disposable`. El comando `git show edb1e05186d296e3699c71306913f16aee470d1e:inventory-api/src/services/billing-api-client.service.js` sobre un clon de Inventori entrega esos bytes; no usar su HEAD variable. El harness E2E migra **solo** la base etiquetada y descartable que crea.

## Gates y riesgos

- W0 es un gate técnico local. No acredita STAG, aceptación de otros tipos de comprobante ni producción.
- La comparación Prisma efectiva requiere decisión de DBA. No ejecutar `migrate diff` como SQL de reparación ni `migrate resolve` sobre la base normal.
- El cliente Inventori fijado prueba un recorrido real y los fixtures protegen contratos, pero las 42 rutas no tienen cada una un E2E independiente.
- No hubo cambios de código fiscal productivo, migraciones reales, merge, despliegue ni ejecución de W1.
