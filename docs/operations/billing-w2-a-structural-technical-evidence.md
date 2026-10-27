# Billing W2-A — cierre técnico estructural

**Base:** `9c9723f`, rama aislada `codex/billing-w2-a-structural`. **Estado:** `W2_A_STRUCTURAL_TECHNICAL_PASS` local. No se importó ningún módulo W2 en `AppModule`, no hay controlador de emisión v2, DDL nuevo, migración real, merge ni despliegue.

## Implementación verificable

- DTO W2-A con objetos cerrados, 1–1.000 líneas y números únicos, hasta cinco descuentos por línea, cuatro medios de pago, diez referencias fiscales y 20 impuestos declarados por línea como límite técnico. `source` es procedencia opaca: no acepta ledger, `consumerId` ni asociación en el body. Los períodos son fechas reales y ordenadas.
- Transporte decimal exacto acotado a 18 dígitos enteros y 10 fraccionarios. La cantidad debe ser positiva; precio, descuentos y montos declarados son no negativos. Se rechaza un descuento superior al bruto remanente con enteros exactos. `INCLUSIVE` y `exemptionDocument` permanecen bloqueados. El límite de transporte **no es** una escala fiscal aprobada.
- Normalización con decimales sin ceros superfluos, línea en orden `lineNumber`, fecha de referencia en UTC, orden original de descuentos, tributos, pagos y referencias, y ausencia diferenciada de `null`. Los totales estructurales distinguen bruto, descuentos, neto e impuesto declarado; no verifican tarifa, tratamiento, CABYS, exoneración, redondeo fiscal ni conciliación de pago.
- Hash candidato `w2-a-structural.v1` del JSON canónico y del origen **confiable** (tenant, consumidor, asociación, empresa, ambiente). Vector sintético SHA-256: `605bb6c5fca164508682be3855be458a212f0658d4255ed296c6f7896f4aac96`. No se persiste en reservas W1 ni se presenta como `fiscal-payload.v2`; ADR-BIL-013 debe aprobar el hash fiscal final.
- OpenAPI permanece `proposed-inactive`, refleja límites y rechazos W2-A. La tabla C01–C54 mantiene sus 54 estados auditados y añade evidencia estructural sin elevar capacidades fiscales.

## Validación reproducible

| Gate | Comando | Resultado |
|---|---|---|
| DTO, decimales, normalización, hash y negativos | `npx jest --runInBand --silent --testTimeout=30000 src/modules/fiscal-intent-v2/__tests__/w2-a-structural-intent.spec.ts` | 15/15 |
| OpenAPI W2-A, C01–C54 y 42 pares v1 | `npm run test:w1:d0` | 38/38; 7 suites |
| Unidad completa | `npm test -- --runInBand --silent --testTimeout=30000` | 1.353 aprobadas; 13 omitidas preexistentes; 118 suites aprobadas |
| Seguridad | `npm run test:safety:static`; `npm run test:safety` | PASS; 35/35 |
| Tipos, compilación, lint | `npm run typecheck`; `npm run build`; `npm run lint:check` | PASS; lint 0 errores y 26 advertencias preexistentes |
| E2E Inventori y W1 | `$env:INVENTORI_BILLING_CLIENT_PATH='C:\Users\kmena\AppData\Local\Temp\billing-inventori-client-edb1e051.js'; npm run test:e2e:disposable` | 25/25 migraciones en PostgreSQL descartable; 28 suites, 165/165 E2E |

El cliente Inventori fijado coincide con SHA-256 `1bc069fa657569ce3c489b633775adea8ba362bbe3c3f19e0051209c88ea9da0`. La primera corrida E2E dio 164/165 por una carrera en `resetFiscalE2eData`: una inserción asíncrona de `delivery_attempts` podía ocurrir entre el borrado de intentos y de entregas. El helper ya reintentaba un `P2003` en el borrado final del documento; ahora cubre la secuencia completa de limpieza sintética. La suite afectada pasó 15/15 en base nueva y la repetición integral 165/165. La corrección solo modifica el harness de pruebas.

## Riesgos y gates pendientes

- ADR-BIL-011/012/013, DP-01/02 y DF-01–DF-06 no están aprobados. Códigos, tarifas, moneda, exención/exoneración, precio incluido, redondeo y hash de snapshot fiscal quedan fuera de W2-A. Los valores `pending-*` de OpenAPI son ejemplos de diseño, nunca defaults de emisión.
- W1_TARGET_DB_READINESS, STAG y producción siguen `NOT_READY`; la base objetivo y las 16 divergencias requieren revisión DBA. Las migraciones se ejecutaron únicamente en PostgreSQL descartable.
- El fallo histórico intermitente XAdES conserva investigación abierta; el PASS de las suites no equivale a aceptación de Hacienda ni valida tipos de comprobante nuevos.

No continuar con W2-B sin autorización y decisiones aplicables.
