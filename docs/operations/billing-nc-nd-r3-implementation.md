# W4-B-R3 — implementación técnica NC/ND

Base: `codex/billing-spec-af-w4b-r2` en `11eb072e7aff2edc098151ef342c2e6a38f1b8c2`. Trabajo aislado: `codex/billing-spec-af-w4b-r3`. Commit de código: `36f799d066c2cffadae565647b028b76ca9893bf`.

Se reutilizó el motor NC/ND de R2. Para que el controlador M2M de laboratorio arranque con Nest se añadió `ApiKeysModule` a `CorrectiveNotesLabModule`: resuelve `ValidateApiKeyHandler` del guard real. El módulo continúa fuera de `AppModule` y su constructor exige `NODE_ENV=test`. La prueba importa el módulo explícitamente. No hay ruta de envío NC/ND a Hacienda.

La validación temprana del código de referencia usa el catálogo estructural del XSD NC/ND v4.4 fijado en el repositorio (`01`, `02`, `04`–`12`, `99`). El serializador aplica el mismo catálogo. La solicitud exige un código explícito; no se decidió cuál corresponde a cada causa comercial. Un código no admitido responde 400 antes de reservar consecutivo.

El helper E2E acepta el módulo correctivo solo cuando la prueba lo solicita y limpia la auditoría de notas antes de borrar documentos del laboratorio. La nueva suite HTTP utiliza dos empresas, API keys y certificados sintéticos, el servicio Nest real, Prisma y PostgreSQL descartable. Los originales se crean en laboratorio y se marcan `ACCEPTED` únicamente en esa base de prueba. Se verifican documento, referencia original, snapshots de emisor y receptor, líneas, totales, identidad fiscal, auditoría, artefacto XML y ausencia de submissions.

Las migraciones NC/ND de R2 no se modificaron. Su ejecución y checksum se documentan en [PostgreSQL](billing-nc-nd-r3-postgresql.md). El resultado técnico y sus límites están en [cierre](billing-nc-nd-r3-closure.md).
