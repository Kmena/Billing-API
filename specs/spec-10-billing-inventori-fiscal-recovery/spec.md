# SPEC-10 — Recuperación del flujo fiscal Inventori → Billing

Estado: auditoría y diseño local, 2026-11-06. Rama `codex/spec10-billing-inventori-recovery`, base Billing `33df203cff798bc470670ad37e27e8177fab0769`.

## Problema y alcance

F4-S demostró que el pipeline de Billing recibió un documento en Hacienda SANDBOX y luego obtuvo `ind-estado=aceptado`. Eso **no demuestra** que el documento lo originó Inventori ni que se entregó por correo. La instalación actual tiene dos Billing y la emisión ordinaria de ambos consumidores está deshabilitada. El objetivo es converger en un Billing custodio, conservando sus documentos y la configuración de cada empresa, sin integrar Hacienda por tercera vez.

Esta especificación es de lectura, pruebas sintéticas descartables y diseño. No modifica servicios persistentes ni la factura SPEC-09 `140adc48-7e4e-42bb-85bb-effe017483e2` (clave, consecutivo, XML, intento HTTP 403 y estado `MANUAL_REVIEW_REQUIRED`). No autoriza GET/POST fiscales, nuevas facturas, correo real ni actualización de Docker.

## Evidencia y método

- Commit F4-S: `04e7f1e40b86775aba88601a878ea5efe7b4b7c6`, 2026-09-22. Informe histórico `C:\Users\kmena\Documents\proyectos\Billing\specs\fase-4-s-hacienda-sandbox-validation\implementation-report.md` y evidencia sanitizada `C:\Users\kmena\Documents\proyectos\Billing\test-output\hacienda-sandbox\TASK-009-STATUS\task-009-status-1790122709729.json` (SHA-256 `b33ab0d6c257d53e6b1cd938ee28461645acf11fe5db2fc6e0c5574700c9dd13`).
- Código actual Billing: adaptador Hacienda, OAuth, controladores v1/v2 y workers. Inventori: `billing-api-client.service.js`, `fiscal-billing-worker.service.js`, servicios de artefactos. Inventori fue consultado en solo lectura; su worktree contiene cambios ajenos.
- Docker fue inventariado mediante `ps` e `inspect` sin leer valores secretos. Se inspeccionaron solo flags y URLs permitidos; ninguna base persistente fue escrita.
- F4-S unitario con red simulada: 396/396. Contratos del cliente Inventori: 37/37. E2E en PostgreSQL `postgres:15-alpine` con datos/certificado sintéticos, 32 migraciones en contenedor etiquetado y descartado: 30/30, tres suites. Véase `test-plan.md` para límites.

## Gates

| Gate | Estado | Fundamento |
| --- | --- | --- |
| `HISTORICAL_FLOW_RECONSTRUCTED` | PASS | Commit, pipeline y aceptación fiscal real documentados; origen Inventori y correo quedan explícitamente sin probar. |
| `CURRENT_ARCHITECTURE_AUDITED` | PARTIAL | Dos Billing y conexiones confirmados; SHA del código en la imagen histórica y ledger detallado de ambas bases requieren inventario forense posterior. |
| `CREDENTIAL_REQUIREMENTS_VALIDATED` | PASS | La contraseña extra pertenece solo al script de reenvío manual; se separan usuario Inventori, M2M, P12, OAuth, clave maestra y SMTP. |
| `REGRESSIONS_IDENTIFIED` | PARTIAL | Endpoint anterior de SPEC-09 causó 403 en gateway; el endpoint se corrigió, pero no hay recepción actual confirmada. |
| `HISTORICAL_FLOW_REPRODUCED` | PARTIAL | Suites sintéticas de Billing cubren XML/firma, 202/GET, persistencia y entrega por separado; falta prueba continua desde Inventori. |
| `TARGET_ARCHITECTURE_DEFINED` | PASS | Contratos, custodias y convergencia por fases descritos. |
| `SPEC10_READY_FOR_IMPLEMENTATION` | BLOCKED | Falta decidir fuente de datos histórica por empresa, reconciliar bases/almacenes/consecutivos y aprobar contrato único de emisión v1/v2. |

No confundir `READY_FOR_IMPLEMENTATION` con autorización para instalar, emitir o conectar con Hacienda.
