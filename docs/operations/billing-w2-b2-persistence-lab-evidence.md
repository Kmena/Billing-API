# Billing W2-B2 — creación fiscal persistente en laboratorio

**Base:** `ce171d3`; rama aislada `codex/billing-w2-b2-persistence-lab`. Alcance exclusivo `NODE_ENV=test`, SANDBOX, datos sintéticos y PostgreSQL descartable. El módulo `W2B2FiscalLabModule` no está importado en `AppModule`; no hay ruta fiscal v2 productiva, envío a Hacienda, emisor real, merge ni despliegue.

| Gate | Estado técnico |
|---|---|
| `W2_B2_PERSISTENCE_LAB` | `PASS_LAB_SYNTHETIC`: reserva W1 v2 y documento fiscal comparten transacción; origen M2M y clave fiscal quedan persistidos. |
| `W2_B2_IDEMPOTENCY_LAB` | `PASS_LAB_SYNTHETIC`: namespace asociación/ambiente/operación/clave, hash `w2-b-fiscal-lab.v1`, unicidad, bloqueo de fila, replay y conflicto. |
| `W2_B2_RECOVERY_LAB` | `PASS_LAB_SYNTHETIC`: reintento tras reserva, documento, firma y actualización final; `RECOVERY_REQUIRED` reintentable, `FAILED_TERMINAL` para firma inválida/XSD inválido. |
| `W2_B2_INVENTORI_COMPATIBILITY` | `PASS_LAB`: 42 pares verbo/ruta v1 fijados; el motor compartido conserva la entrada, permisos y tabla idempotente v1. |
| `W2_B2_PRODUCTION_READINESS` | `NOT_READY`: aprobación fiscal, revisión DBA, integración W1, STAG por escenario y autorización productiva pendientes. |

## Implementación y límites

1. El controlador [de laboratorio](../../src/modules/fiscal-intent-v2/w2-b2-lab-invoice.controller.ts) exige la asociación M2M y el scope `fiscal-v2:invoices:create`. El guard existente revalida consumidor, empresa, ambiente, perfil y clave; la transacción vuelve a comprobarlos antes de reservar y crear. Las claves v2 no sirven en v1. Una clave revocada deja de autorizar y la rotación conserva el namespace de la asociación.
2. La proyección W2-B valida y normaliza el contenido **antes** de reservar. La reserva se inserta con `ON CONFLICT DO NOTHING` y `UNIQUE (association_id, environment, operation, key)`. El hash y su versión se comparan en el replay. La asignación de consecutivo, snapshot del documento, origen v2, enlace de reserva y auditoría se realizan en una sola transacción. La reserva v1 no se toca.
3. El XML usa los servicios existentes de serialización, XSD, firma XAdES y almacenamiento. El laboratorio suprime el hook asíncrono de preparación de entrega; v1 lo conserva. El estado local llega a `READY_TO_SUBMIT`; esa condición no significa aceptación de Hacienda. El lease de procesamiento evita dos firmas simultáneas; un reintento conserva `documentId` y consecutivo. La consulta W1 `POST /api/v2/companies/{companyId}/fiscal-documents/{environment}/operations/lookup` exige clave, versión y hash; hash incorrecto u operación ajena devuelven 404.
4. Se añade `FAILED_TERMINAL` únicamente para fallo de verificación de firma o validación XSD tras asignación. La [migración versionada](../../prisma/migrations/20261115000000_w2_b2_terminal_operation_state/migration.sql) amplía restricciones de la tabla v2; se aplica solo a PostgreSQL descartable. La reconciliación de un XML ya firmado restaura `COMMITTED` si se perdió la última actualización de estado.
5. Los rechazos W2-B continúan explícitos: varios impuestos o descuentos por línea, redondeo inexacto, exoneración, tratamientos pendientes, varios pagos, crédito, referencias fiscales, divisas no aprobadas y producción. No se agregan reglas para cuotas, anticipos o REP. `source` permanece como procedencia opaca, sin ledger comercial en Billing.

## Matriz de compatibilidad

| Superficie | Evidencia | Resultado |
|---|---|---|
| v1 Inventori, 42 pares | Contratos W0/W1, suites completas y E2E cliente fijado | Sin cambios de rutas, credenciales, respuestas o semántica fiscal v1. |
| Idempotencia v1 | Tabla `FiscalIdempotencyKey` separada; prueba de documento v2 sin reserva v1 | Sin reutilización de namespace ni clave v1. |
| M2M v2 | Scopes y binding por asociación, empresa y ambiente; negativos de consumidor cruzado, revocación, rotación, solo lectura y producción | Solo el laboratorio puede crear FE sintética. |
| Contrato fiscal v2 propuesto | [OpenAPI W2-B2 lab](../contracts/billing-w2-b2-lab.v2.openapi.yaml) separado de [propuesta general](../contracts/billing-fiscal-intent.v2.proposed.openapi.yaml) | `fiscal-payload.v2` y ruta productiva siguen inactivos. |

## Validación reproducible

```powershell
npm run typecheck
npm run build
npm run lint:check
npm run test:safety:static
npm run test:w1:d0
npm test -- --runInBand --silent
node scripts/test-safety/disposable-postgres.mjs run -- node scripts/test-safety/run-disposable-validation.mjs e2e w2-b2-persistent-invoice
$env:INVENTORI_BILLING_CLIENT_PATH='C:\Users\kmena\AppData\Local\Temp\billing-inventori-client-edb1e051.js'
npm run test:e2e:disposable
```

El runner descartable crea una base nueva, aplica las 26 migraciones y la elimina al terminar; `docker ps --filter label=com.billing.test-safety` quedó vacío. El manifiesto de checksums incluye la migración W2-B2. Pruebas focales: **9/9 E2E**, incluida creación persistente de FE, XML/XSD, firma, replay, conflicto, concurrencia, recuperación y negativos. Contratos: **40/40**. Unidad completa: **1.363 aprobadas, 13 omitidas preexistentes, 0 fallidas**; build y typecheck PASS; lint PASS con 26 advertencias preexistentes; seguridad estática PASS. E2E completo con cliente Inventori fijado: **29 suites, 174/174 aprobadas**, 26 migraciones aplicadas desde base vacía. La primera corrida E2E detectó una aserción histórica que fijaba 25 migraciones; se reemplazó por comparación exacta con el manifiesto y la segunda corrida terminó sin fallas.

## Trazabilidad y bloqueos

T06/C13,C22–C31,C33,C34 avanzan únicamente para el subconjunto FE sintético ya delimitado en W2-B. C38/C45 prueban namespace, hash y origen; C39 aporta recuperación local de creación, sin cerrar la recuperación operativa W5; C54 mantiene el ledger comercial fuera de Billing. Los estados auditados C01–C54 del SDD no se reclasifican por esta prueba.

Permanecen pendientes la aprobación formal de ADR-BIL-011/012/013/016, DP-01/02 y DF aplicables, catálogos/XSD fijados para el emisor, las 16 divergencias de esquema y revisión DBA de la base objetivo, casos tributarios por escenario, STAG y autorización de producción. El nuevo DDL requiere revisión DBA antes de cualquier integración; este corte no la sustituye.
