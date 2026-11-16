# W4-B-R3 — PostgreSQL descartable

La herramienta existente `scripts/test-safety/disposable-postgres.mjs` creó por ejecución un contenedor `postgres:15-alpine` con nombre, usuario, contraseña y base sintéticos, puerto aleatorio ligado a loopback, datos en `tmpfs` y etiqueta `com.billing.test-safety=true`. No usó volúmenes persistentes ni bases instaladas. `scripts/test-safety/run-disposable-validation.mjs` aplicó desde cero las 23 migraciones presentes. El contenedor y los archivos temporales se eliminaron al terminar, también en el manejador de error.

Se ejecutaron `npm ci --offline --ignore-scripts`, `npx prisma generate`, `npx prisma validate` y `npm run test:safety:db`. El esquema fue válido; el test de seguridad de la base pasó 8/8. La suite HTTP R3 conectó por Prisma al PostgreSQL aislado y comparó en `_prisma_migrations` los SHA-256 aplicados con los archivos locales de `20261111090000_lab_corrective_note_types` y `20261111100000_lab_corrective_notes`: ambos coincidieron. La creación y recuperación HTTP prueban conectividad de lectura y escritura.

No se detectó divergencia de checksum en el laboratorio creado desde cero. Esto no demuestra el estado de migraciones de una base instalada o de un futuro candidato de integración. La comparación se debe repetir allí antes de instalar; no se corrigió ningún historial persistente. Al cierre, `docker ps -a --filter label=com.billing.test-safety=true` no devolvió contenedores.

**Migraciones NC/ND: PASS_LAB. Migraciones instaladas o productivas: no ejecutadas.**
