# W4-B-R3 — resultados reproducibles

| Ejecución | Alcance | PASS | FAIL | SKIP | TIMEOUT |
|---|---|---:|---:|---:|---:|
| `npm run test:safety:db` | PostgreSQL descartable y política de aislamiento | 8 | 0 | 0 | 0 |
| `npm run test:e2e:disposable -- corrective-notes-lab.e2e-spec.ts` | HTTP NC/ND, checksums, firma, seguridad, fallos y reinicio | 11 | 0 | 0 | 0 |
| `npm run test:e2e:disposable -- 'fiscal-documents.e2e-spec.ts|fiscal-concurrency.e2e-spec.ts|fiscal-xml-signing.e2e-spec.ts'` | Facturas/tiquetes, M2M, persistencia, concurrencia, XML y firma | 18 | 0 | 0 | 0 |
| `npx jest --runInBand` con siete suites focales R1/R2 | XML NC/ND, XSD, XAdES, autorización y gate fiscal | 56 | 0 | 0 | 0 |
| **Total de pruebas ejecutadas** | | **93** | **0** | **0** | **0** |

También pasaron `npx prisma generate`, `npx prisma validate`, `npx tsc --noEmit --incremental false`, ESLint de los seis archivos TypeScript modificados y `git diff --check`. `npm ci --offline --ignore-scripts` se completó. Las dos migraciones NC/ND aplicadas en las ejecuciones descartables tuvieron checksums iguales a los archivos locales. No se contó ningún SKIP como PASS.

La prueba HTTP R3 comprueba un XML firmado NC y uno ND contra sus XSD v4.4 y verifica criptográficamente ambos con certificado sintético. Las suites focales R1/R2 vuelven a cubrir exenta, IVA 0 %, IVA 13 % y multilínea; el E2E de regresión cubre facturas y tiquetes. No se contactó Hacienda.

Los tres suites E2E de regresión salieron con código 0 y 18/18, pero un hook PDF asíncrono heredado registró `Test environment has been torn down` después del fin de Jest. Se conserva como riesgo de limpieza del harness; no se cambió código ajeno para ocultarlo. No se ejecutó toda la matriz del repositorio fuera de estas suites relevantes.
