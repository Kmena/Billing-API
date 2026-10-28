# W0–W3 · decisiones operativas y preparación STAG

**Fecha:** 2026-10-28. **Base:** `8225151`, rama `codex/billing-w0-w3-integration-candidate`. Alcance: código y pruebas sintéticas en PostgreSQL descartable; no se operó una base objetivo, un emisor real, Hacienda ni un servidor.

## Cambio verificable

- DP-01: ruta administrativa de laboratorio `POST /api/v2/integrations/consumers/{consumerId}/associations/{associationId}/reassign`. Exige JWT `TENANT_ADMIN`, nueva clave externa de emisor y empresa destino del mismo tenant. Comprueba identidad legal verificada, actividad fiscal activa, punto de emisión con sucursal/terminal, conexión configurada y certificado vigente con identidad coincidente. La revisión de secretos reales permanece para STAG. La transacción serializable bloquea reservas y documentos pendientes, crea o reutiliza una asociación destino, suspende la antigua, revoca sus claves y audita IDs anterior/nuevo. No reescribe documentos ni cambia Inventori v1.
- Las rutas v2 siguen solo en módulos de prueba con `NODE_ENV=test`, sin importación en `AppModule`. No hay activación productiva por bandera.
- `scripts/billing-update` y `scripts/billing-update.mjs` preparan `sudo billing-update`. Exigen SHA aprobado de `main`, checkout limpio, preflight, backup con manifiesto, restauración de prueba, actualización API/worker y health. Los ejecutores del servidor aún deben configurarse y probarse. No se instaló ni ejecutó en servidor.

## Decisiones y límites

| Asunto | Criterio aplicado | Pendiente antes de integración real |
|---|---|---|
| ADR-BIL-011 | Identidades/credenciales independientes, scopes y vínculo por empresa/ambiente. La clave externa es inmutable. | Firmas de arquitectura, seguridad y DBA; discrepancia si se exige remapear la misma clave externa. |
| ADR-BIL-012 | Reserva v2 por asociación/ambiente, hash y lookup obligatorios; v1 intacto. | Firma formal y revisión DBA/retención. |
| DP-01 | Dos consumidores pueden usar una misma `Company` sintética y uno pasar después a otra con nueva clave externa; solo operaciones futuras. | Identidad legal del emisor real, dueño, asociación Inventori existente, secretos verificables y autorización de ambiente. |
| ADR-BIL-014/016 y DF-06 | Se conserva el subconjunto NC total/parcial/remanente y ND de laboratorio, ledger decimal, concurrencia, idempotencia y XML/XSD/XAdES. | Política fiscal para secuencias mixtas NC/ND, notas sobre versiones previas y códigos por escenario. Ningún tratamiento nuevo se libera. |

Se contrastó el [Anexo oficial v4.4](https://www.hacienda.go.cr/docs/ANEXOS_Y_ESTRUCTURAS_V4.4.pdf), nota 9 e información de referencia, con la [comunicación de actualización](https://www.hacienda.go.cr/docs/ActualizacionAnexosyEstructurasVersion4.4CEv2.pdf). El Anexo incluye códigos 01/02/06/13–16 y un límite acumulado de NC que considera ND previas; la comunicación fija la adopción de códigos nuevos desde el 1 de noviembre de 2026. Estos textos no eligen el código ni efecto contable para una operación concreta. DF-06 sigue pendiente.

## Evidencia y trazabilidad

| Capacidad / gate | Evidencia | Resultado |
|---|---|---|
| C03,C08,C11,C12,C38,C45; T03–T05 | DP-01 E2E, guards, contrato OpenAPI, 42 pares v1 protegidos | Implementación sintética; autorización real pendiente. |
| C15–C17,C33,C34; T08 | Suites W3 NC/ND, XML/XSD/XAdES y ledger acumulado existentes | `PARTIAL_LAB` por ADR-014/016/DF-06. |
| C49,C50 | Sin conexión a Hacienda, STAG ni producción | `NOT_READY`. |
| C51,C53 | 27 migraciones desde PostgreSQL vacío; diff histórico de 16 tablas; sin conexión objetivo autorizada | `DBA_PREFLIGHT_BLOCKED`; backup/restore de destino sin probar. |
| Actualización | `node --test scripts/billing-update.test.mjs`, fases y fallos simulados | 3/3 PASS; sin acciones reales. |

**Comandos y resultados:** `npm test -- --runInBand`: 1.375 PASS, 13 omisiones preexistentes; `npm run test:w1:d0`: 42/42 PASS; `npm run test:e2e:disposable`: 188/188 PASS, 30 suites y 27 migraciones desde base vacía; `npm run test:e2e:disposable -- w1-d2-consumer-lab` tras añadir rollback de auditoría: 10/10 PASS; `npm run build` y `npm run typecheck`: PASS; `npm run lint:check`: 0 errores, 26 advertencias preexistentes; `npm run test:safety:static`: PASS; `node --test scripts/billing-update.test.mjs`: 3/3 PASS. La E2E con cliente real de Inventori requiere `INVENTORI_BILLING_CLIENT_PATH` hacia su archivo existente de solo lectura; la primera ejecución sin esa variable falló al buscarlo en la ruta relativa del worktree. En este host se usó `C:\Users\kmena\Documents\proyectos\inventory-api\inventory-api\src\services\billing-api-client.service.js`. No se modificó Inventori. Algunas suites históricas emiten logs tardíos de PDF tras teardown; no produjeron fallos de suite y siguen como riesgo del harness.

## Gates

| Gate | Estado |
|---|---|
| `BILLING_W0_W3_INTEGRATION` | `CANDIDATE_PARTIAL_LAB` |
| `DP01_REASSIGNMENT` | `PASS_LAB_SYNTHETIC`; operación real pendiente |
| `CREDIT_NOTE_READINESS` | `PARTIAL_LAB` |
| `DEBIT_NOTE_READINESS` | `PARTIAL_LAB` |
| `DBA_TARGET_PREFLIGHT` | `BLOCKED_NO_AUTHORIZED_CONNECTION` |
| `SIMPLE_DEPLOYMENT_READINESS` | `IMPLEMENTED_MOCK_VERIFIED_TARGET_NOT_READY` |
| `STAGING_READINESS` | `NOT_READY` |
| `PRODUCTION_READINESS` | `NOT_READY` |

**Bloqueos concretos:** DBA debe aportar preflight de solo lectura y clasificar las 16 divergencias; fiscal debe resolver ADR-014/016 y DF-06 por escenario; operaciones debe ensayar secretos, respaldo/restore y rollout en STAG. Los tests sintéticos no sustituyen esas aprobaciones.
