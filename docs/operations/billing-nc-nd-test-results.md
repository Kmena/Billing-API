# Resultados W4-B-R2 (11 de noviembre de 2026)

Base `92594854f861f8343b1b4f50f722fa7177aa02a4`; rama `codex/billing-spec-af-w4b-r2`. Todas las pruebas usaron datos sintéticos locales. No se consultó Hacienda ni se usó una base instalada.

| Prueba | Resultado | Evidencia |
|---|---|---|
| XSD NC/ND fijados por SHA, XML sin firma, firma XAdES, XSD firmado: exenta/0 %/13 %/multilínea | PASS | `w4b-r2-corrective-notes.spec.ts`: 11/11; 8 XML firmados |
| Gate de creación, envío y transporte Hacienda | PASS | `w4b-r2-issuance-gate.spec.ts`: 3/3 |
| Regresión XML R1/R2, XSD NC, autorización por empresa y equivalencia de payload | PASS | 5 suites; 42/42 |
| TypeScript | PASS | `npx tsc --noEmit --incremental false` |
| Prisma schema | PASS | `npx prisma validate` con URL sintética sin conexión |
| ESLint de TypeScript cambiado | PASS | `npx eslint` focal |
| Migraciones en PostgreSQL descartable | SKIP | No hay binarios PostgreSQL locales; Docker instalado no se modificó. |
| M2M HTTP NC/ND con base descartable | SKIP | Requiere PostgreSQL descartable. |
| Idempotencia concurrente, timeout tras commit y reinicio | SKIP | Requiere PostgreSQL descartable y dos conexiones. |
| Auditoría durable en base | SKIP | Archivo de migración y escritura transaccional revisados, sin ejecución. |
| Aceptación por Hacienda | SKIP | Prohibida por el alcance. |

El primer intento XML NC/ND falló en prevalidación porque el validador de R2 solo reconocía las raíces de factura y tiquete al tolerar la firma aún ausente. Se amplió esa lista a NC/ND; el rerun pasó 11/11. La ejecución sin permiso de subproceso Python devolvió fallos de validador del sandbox; la repetición autorizada del proceso local obtuvo el resultado anterior. Ningún SKIP cuenta como PASS.
