# W4-B-R3 — plan de promoción a main (no ejecutar)

Rama base `codex/billing-spec-af-w4b-r2`, SHA base `11eb072e7aff2edc098151ef342c2e6a38f1b8c2`. Rama final `codex/billing-spec-af-w4b-r3`. Commit de código R3 `36f799d066c2cffadae565647b028b76ca9893bf`; el SHA final del commit de documentación se consigna en la respuesta de entrega, ya que el archivo no puede contener el SHA de su propio commit.

`main` observado: `e7f8fff87cc1fe1f4122fe6544957ab0c001b757`; ancestro común: `3b0893fb02bbe0fb6e51ebcda795a7d1555f3820`. La diferencia `main...R3` incluye el trabajo XML v4.4 R1/R2, XSD NC/ND fijados, contrato y motor NC/ND R2, dos migraciones aditivas de notas y las pruebas/correcciones R3. `main` contiene cambios posteriores propios; no se verificó un merge ni se resolvieron conflictos. Tratar los conflictos como desconocidos hasta construir un candidato aislado.

Dependencias: commits XML R1/R2, `.gitattributes` para XSD, modelos y servicios fiscales R2, catálogo de referencias R3. Migraciones requeridas para una integración futura: `20261111090000_lab_corrective_note_types` y `20261111100000_lab_corrective_notes`, sujetas a revisión de la cadena completa del candidato. R3 aplicó ambas solo en PostgreSQL descartable.

Orden propuesto: (1) actualizar `main` y crear candidato aislado; (2) revisar y portar R1/R2 XML en orden, luego R2 NC/ND y R3; (3) resolver diferencias de Prisma, guards, XML y test helpers mediante revisión; (4) generar Prisma, validar esquema y aplicar todas las migraciones a una base nueva descartable, comparando checksums; (5) correr seguridad DB, R3 HTTP, regresión de factura/tiquete y suites XML/XAdES; (6) decidir referencia, período, pagos y riesgo fiscal con responsables antes de cualquier exposición; (7) revisión de seguridad y autorización de activación separada. Mantener el módulo lab fuera de entrypoints instalados.

Rollback de candidato antes de instalar: descartar el candidato aislado. Tras instalar una migración aditiva en una fase futura, desactivar código/rutas y preparar una migración compensatoria revisada; no borrar columnas ni valores enum directamente en base instalada. La reversión fiscal de NC/ND requiere política propia y no se deduce de este plan.

**BILLING_MAIN_MERGE_READY = NO.** Bloqueos: divergencia no reconciliada, historial del candidato no comparado y decisiones fiscales pendientes. No se hizo push, merge ni despliegue.
