# Billing — anulación, sustitución y reversión en laboratorio

**Base:** `codex/billing-ab-integration-candidate` @ `a573635`. **Rama:** `codex/billing-cancellation-reversal-lab`. **Fecha:** 2026-10-28.

## Alcance implementado

- Anulación ordinaria de FE sintética aceptada con NC total, motivo obligatorio, espera de aceptación y conservación del original.
- Borrador validado y precargado desde el snapshot fiscal, edición permitida bajo proyección W2, confirmación explícita y nueva FE con clave y consecutivo nuevos.
- `REVERSE_CANCELLATION` sin sustituta: verifica NC aceptada y guarda plan de ND que referencia directamente esa NC, sin emitir la ND.
- Con sustituta aceptada: emite NC total de la sustituta, espera su aceptación y guarda el plan de ND contra la NC original. Con sustituta rechazada omite NC adicional. El rechazo de NC original o de NC de sustituta deja `RECOVERY_REQUIRED`.
- Tabla aditiva de flujo con relación documental, versionado, hashes y claves de idempotencia. Estado fiscal derivado de documentos persistidos, bloqueo transaccional por fila, eventos `FISCAL_AUDIT`, acceso M2M con scopes y aislamiento por tenant, empresa y asociación.
- Controlador v2 únicamente en `W3AFiscalLabModule`, ausente de `AppModule`, más guardia de `NODE_ENV=test` y SANDBOX. Contrato [OpenAPI](../contracts/billing-cancellation-reversal.v2.lab.openapi.yaml).

## Evidencia reproducible

Comandos desde la rama aislada, con PostgreSQL descartable para toda prueba que aplica migraciones:

```powershell
npm run test:w0:schema
npm test -- --runInBand
npm run test:w1:d0
$env:INVENTORI_BILLING_CLIENT_PATH='C:\Users\kmena\Documents\proyectos\inventory-api\inventory-api\src\services\billing-api-client.service.js'
npm run test:e2e:disposable
npm run test:safety:static
npm run test:safety
npm run test:safety:db
npm run build
npm run typecheck
npm run lint:check
```

`npm run test:w0:schema`: 28 migraciones aplicadas y 28 checksums iguales, 0 pendientes, exclusivamente en PostgreSQL descartable. El diff histórico del datamodel sigue requiriendo revisión DBA. La migración nueva `20261117000000_cancellation_reversal_lab` tiene SHA-256 `ad54e2b05c7b6af8d1728540c60fdf4ef115bbe83a36754051cba042885f9a5d`, fijado en el manifiesto.

`npm test -- --runInBand`: 121 suites, 1.375 pruebas aprobadas y 13 omisiones previas. `npm run test:w1:d0`: 43 contratos aprobados, incluido el nuevo OpenAPI. `npm run test:e2e:disposable`: 30 suites y 199/199 E2E aprobados, incluido cliente Inventori de solo lectura. `npm run test:safety:db`: 8/8 en dos suites descartables. `npm run build`, `npm run typecheck`, seguridad estática y seguridad unitaria: aprobados. Lint: 0 errores y 26 advertencias previas en tests no modificados. Una primera pasada E2E tuvo un fallo transitorio de conexión a PostgreSQL descartable en la prueba heredada de 100 reservas concurrentes; la segunda pasada completa, sin otras suites simultáneas, aprobó ese caso y todos los demás.

Los casos de laboratorio cubren NC total aceptada, borrador, edición, confirmación, XML/XSD y firma, reversión con y sin sustituta hasta el bloqueo fiscal, NC sustituta rechazada, NC original rechazada, sustituta rechazada, interrupción y replay, concurrencia, M2M revocado, aislamiento, historial y ausencia comprobada de ND de reversión. La suite E2E completa ejercita el contrato v1 de Inventori sin modificar su repositorio.

| Criterios solicitados | Resultado de laboratorio |
| --- | --- |
| 1–3 · NC total, borrador precargado, edición y confirmación | E2E W3 con NC aceptada sintéticamente, FE nueva y clave/consecutivo distintos. |
| 4–5 · reversión sin y con sustituta | Plan de ND directa sobre NC original; con sustituta aceptada, NC2 emitida y aceptación exigida antes del plan. ND bloqueada. |
| 6–7 · fallo de NC2 y ND | NC2 rechazada → `RECOVERY_REQUIRED`; el fallo de ND no se puede inyectar porque DF-06 bloquea su emisión. Se comprueba que no existe ND y que el flujo no llega a `REVERSAL_COMPLETED`. |
| 8–10 · interrupción, concurrencia y replay | Interrupción de NC y FE sustituta, mismo documento al reanudar, solicitud concurrente con clave distinta → 409 y un solo flujo/NC. |
| 11–15 · rechazos, aislamiento, revocación e historial | NC original y FE sustituta rechazadas; otra empresa obtiene 404, scope insuficiente 403, clave revocada 401; eventos y documentos relacionados consultables. |
| 16–17 · Inventori v1, XML/XSD y firma | Cliente Inventori leído sin modificación en E2E; NC y FE admitidas tienen XSD válido y firma sintética verificable. |

## Decisión fiscal y gates

| Gate | Estado | Motivo |
| --- | --- | --- |
| `FULL_CANCELLATION_LAB` | PASS_LAB_SYNTHETIC | NC total y transición por aceptación sintética verificados. |
| `REPLACEMENT_DRAFT_LAB` | PASS_LAB_SYNTHETIC | Borrador editable y confirmación separada verificados. |
| `REVERSAL_WITHOUT_REPLACEMENT_LAB` | PARTIAL_BLOCKED_FISCAL_POLICY | Plan de ND directo a NC persistido; emisión y aceptación ND no habilitadas. |
| `REVERSAL_WITH_REPLACEMENT_LAB` | PARTIAL_BLOCKED_FISCAL_POLICY | NC sustituta secuencial verificada; ND final no habilitada. |
| `IDEMPOTENCY_RECOVERY` | PARTIAL_LAB_SYNTHETIC | Replay, colisión e interrupción verificados; recuperación supervisada de documentos rechazados pendiente. |
| `FISCAL_POLICY_APPROVAL` | PENDING | ADR-BIL-014/016 y DF-06 sin dictamen fiscal. |
| `INVENTORI_V1_COMPATIBILITY` | PASS_LAB | 42 pares verbo/ruta v1 permanecen sin cambios; E2E completo 199/199 con cliente Inventori de solo lectura. |
| `STAGING_READINESS` | NOT_READY | Sin preflight DBA objetivo ni infraestructura/autorización STAG. |
| `PRODUCTION_READINESS` | NOT_READY | Faltan política fiscal, STAG y autorizaciones. |

No se emitió ND de reversión, no se usaron emisores reales ni Hacienda, y no se ejecutó DDL fuera de bases descartables. La auditoría de aplicación es de solo anexado; su inmutabilidad frente a acceso privilegiado directo depende de controles DBA. No hubo despliegue, merge ni modificación de Inventori.
