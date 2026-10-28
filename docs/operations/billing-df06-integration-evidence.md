# Billing · candidata DF-06 W0–W3

**Fecha:** 2026-10-28. **Base:** `codex/billing-ab-integration-candidate` @ `a573635`. **Integración:** `c169dec` incorporado una vez mediante cherry-pick como `a923263` en `codex/billing-df06-w0-w3-candidate`. `main` local permaneció en `b6c454f`; no hubo merge ni despliegue.

## Alcance técnico

El flujo de anulación total, borrador editable, sustitución explícita y reversión condicional de `c169dec` permanece aislado en `W3AFiscalLabModule`, ausente de `AppModule`. La nueva preparación ND valida que la NC original y, si existe sustituta aceptada, su NC de anulación sean totales y aceptadas en el fixture; comprueba cadena documental, emisor/receptor, clave/consecutivo, referencia original, líneas, impuestos, moneda, totales, artefacto XSD firmado y ausencia de una ND previa no rechazada. El resultado conserva referencia directa a NC (`TipoDocIR=03`), código `01` **candidato**, importes y hash; `issuanceAllowed=false` y `reversalNoteId=null`.

El serializador ordinario sigue rechazando `TipoDocIR=03` para ND. Un método explícito de **previsualización sin persistencia**, protegido por `NODE_ENV=test` y SANDBOX, permite validar XML ND sintético contra el XSD archivado y firmarlo con certificado de prueba. No reserva clave/consecutivo real, no llama al motor de emisión de ND ni a Hacienda. La [matriz DF-06](../design/df-06-normative-matrix-2026-10-28.md) separa base normativa y aprobaciones pendientes.

## Evidencia de validación

| Comprobación | Resultado |
| --- | --- |
| Integración Git | Cherry-pick único, sin conflictos ni cambios ajenos; `main` intacto. |
| Migraciones | `test:w0:schema`: 28/28 aplicadas y checksums iguales, 0 pendientes; `prismaDatamodelDiff=review-required`. `20261117000000_cancellation_reversal_lab` conserva SHA-256 `ad54e2b05c7b6af8d1728540c60fdf4ef115bbe83a36754051cba042885f9a5d`. Ensayo solo en PostgreSQL descartable. |
| Compatibilidad Inventori | Snapshot de 42 pares verbo/ruta v1 sin cambios; cliente Inventori leído sin modificación durante E2E completo, 200/200. |
| Reversión sin sustituta | Preparación ND directa sobre NC aceptada, rechazo de snapshot alterado, replay y bloqueo de emisión. |
| Reversión con sustituta | NC total de FE sustituta aceptada antes de la preparación ND; rechazo/pending mantienen estado recuperable. |
| XML/XSD y firma | Previsualización ND sin persistencia frente al XSD ND v4.4 archivado y firma XAdES sintética; validación previa de NC/FE existente. No acredita aceptación de Hacienda ni vigencia futura. |
| Contratos y regresión | Unitarias 1375 aprobadas (13 omitidas); contratos W1/D0 v1/v2 43/43; E2E 200/200; `billing-update` 9/9; seguridad estática, seguridad 35/35 y seguridad DB 8/8; build, typecheck y lint PASS. Lint conserva 26 advertencias previas de `no-explicit-any` en pruebas ajenas a este cambio, sin errores. |

Comandos reproducibles desde este worktree:

```powershell
npm run test:w0:schema
npm test -- --runInBand
npm run test:w1:d0
$env:INVENTORI_BILLING_CLIENT_PATH='C:\Users\kmena\Documents\proyectos\inventory-api\inventory-api\src\services\billing-api-client.service.js'
npm run test:e2e:disposable
node --test --experimental-test-isolation=none scripts/billing-update.test.mjs scripts/billing-update.integration.test.mjs
npm run test:safety:static
npm run test:safety
npm run test:safety:db
npm run build
npm run typecheck
npm run lint:check
```

## DBA y STAG

No hay `DATABASE_URL`, `DIRECT_URL`, `BILLING_TARGET_DATABASE_URL`, `BILLING_STAG_DATABASE_URL`, `.env` ni `.env.local` en esta sesión. No existe conexión DBA objetivo autorizada, por lo que las **16 divergencias** del diff histórico no pueden confirmarse contra la base objetivo. El [preflight de solo lectura](billing-w1-d0-dba-readonly.sql) debe ejecutarlo el DBA autorizado, comparar 28 nombres/checksums y clasificar cada divergencia antes de cualquier DDL. La migración nueva agrega solo una tabla de orquestación SANDBOX y FKs a documentos; no se ejecutó DDL en STAG ni producción.

`scripts/billing-update` conserva el ensayo de `sudo billing-update` con Git limpio, SHA aprobado de `main`, preflight, backup/restore, API, worker, health y registro de versión. Sus siete ejecutores específicos de STAG no están configurados. La topología, montajes, secretos, backups y restore del destino siguen sin evidencia autorizada. La [evidencia de Frente B](billing-front-b-stag-readiness.md) y el [runbook](billing-w0-w3-update-runbook.md) detallan las verificaciones pendientes. Esta candidata no está en `main`, de modo que no existe SHA aprobado de `main` que el actualizador pueda aplicar.

## Gates

| Gate | Estado | Bloqueo real |
| --- | --- | --- |
| `DF06_NORMATIVE_REVIEW` | `PARTIAL_EVIDENCE_TAX_APPROVAL_PENDING` | Referencia ND→NC y candidato `01` respaldados por AE44; falta dictamen sobre código concreto, período, impuestos, sustituta y vigencia de XSD/catálogo. |
| `ND_REVERSAL_LAB` | `PARTIAL_PREPARATION_ONLY` | Plan validado y XML/XSD/firma sintéticos; emisión, aceptación y cierre comercial bloqueados. |
| `CANCELLATION_REPLACEMENT_INTEGRATION` | `PASS_LAB_SYNTHETIC` | Flujo y trazabilidad integrados; FE sustituta requiere referencia fiscal `07` antes de operación real. |
| `INVENTORI_V1_COMPATIBILITY` | `PASS_LAB_SYNTHETIC` | 42 rutas sin cambios y E2E con cliente Inventori en lectura; sin prueba de STAG. |
| `DATABASE_MIGRATION_READINESS` | `PASS_DISPOSABLE_TARGET_BLOCKED` | 28 migraciones descartables y checksums PASS; `prismaDatamodelDiff=review-required`, DBA objetivo y 16 divergencias pendientes. |
| `STAGING_READINESS` | `NOT_READY` | Sin topología, ejecutores, restore real, dictamen fiscal ni autorización. |
| `PRODUCTION_READINESS` | `NOT_READY` | Requiere cierre fiscal, DBA, STAG y autorización separada. |

No se utilizaron emisores reales ni Hacienda; no se modificó Inventori y no se activaron rutas v2 productivas.
