# Billing W4-B-R1 — resultados verificables

Rama `codex/billing-spec-af-w4b-r1`, base R2 `3259908`. No se usó PostgreSQL, Docker, credenciales instaladas, Hacienda ni correo. `npm ci --offline --ignore-scripts` y `npx prisma generate` se ejecutaron solo en este worktree.

| Verificación | Resultado |
|---|---|
| SHA-256 y tamaño XSD oficial NC | PASS: `a86a86d2f3ad85d050b85b09fd6b8d450beed76f6dcdbe60e0dfe259b3f97ef7`, 118974 bytes |
| Compilación directa XSD NC, `python-xmlschema` 4.3.2 | PASS, XML Schema 1.1 |
| Jest focal NC | 2/2 PASS con permiso para subproceso Python local |
| TypeScript `tsc --noEmit --incremental false` | PASS |
| ESLint de los tres TS cambiados | PASS |
| Regresión XML R1/R2 y XSD | 25/25 PASS en rerun tras restaurar bytes del XSD de tiquete |
| Lint completo de Billing R2 | FAIL basal: 149 errores en archivos no modificados; no se ejecutó `--fix` global |
| NC firmada, XML NC/XSD, M2M, Afiliaciones E2E, pagos/Tesorería, base descartable | NOT_RUN; ningún PASS inferido |

La primera prueba Jest NC falló porque el sandbox negó `spawnSync python` (`EPERM`); el mismo test pasó al autorizar solo el subproceso local. La primera regresión XML tuvo 5 fallos en tiquete: el checkout Windows dejó CRLF en `TiqueteElectronico.xsd`, con hash físico `cda1c7...`, mientras el blob Git conservaba `aaa273b...`. Se repusieron los bytes del blob únicamente en este worktree, se añadió regla `.gitattributes` para XSD byte-pinned y el rerun pasó 25/25. No se cambió la lógica de facturas/tiquetes.

**Gate de W4-B-R1: PARTIAL.** La compilación del XSD no demuestra que una NC se genere, firme o acepte. Migraciones R1: ninguna; `PASS_LAB` no aplica sin motor ni base descartable.
