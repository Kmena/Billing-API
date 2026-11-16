# Plan de promoción a main — NO EJECUTAR

Base R2 `92594854f861f8343b1b4f50f722fa7177aa02a4`; `main` observado `e7f8fff87cc1fe1f4122fe6544957ab0c001b757`. `main` y R1/R2 divergen desde `3b0893fb02bbe0fb6e51ebcda795a7d1555f3820`. El rango `main..R1` incluye los commits XML R1/R2 (`634114b`, `9fdf040`, `4b48585` y documentación asociada), el pin NC `9e20553` y cierre `9259485`. W4-B-R2 agrega `2eca791` (motor NC/ND, XSD ND, pruebas y dos migraciones aditivas) y un commit de documentación. Comparar en un candidato nuevo; nunca promover esta rama por fast forward supuesto.

Orden propuesto: (1) revisar y portar selectivamente correcciones XML R1/R2 sobre el `main` vigente; (2) portar el XSD NC con `.gitattributes`; (3) reconciliar código NC/ND con cambios posteriores de `main`; (4) aplicar **solo a PostgreSQL descartable** las migraciones `20261111090000_lab_corrective_note_types` y `20261111100000_lab_corrective_notes`; (5) correr regresión y pruebas M2M concurrentes; (6) obtener decisiones fiscales de referencia, pagos y período; (7) solicitar revisión de seguridad y autorización separada para cualquier activación. La política del módulo sigue fuera de `AppModule`.

Rollback de candidato: retirar los commits de código antes de instalar. Una vez aplicada la migración, conservar columnas/tipos aditivos y deshabilitar el módulo; la eliminación de enum PostgreSQL requiere migración planificada independiente. No ejecutar rollback destructivo en una base instalada.

**BILLING_MAIN_MERGE_READY = NO.** Bloquean la promoción la divergencia de `main`, la validación PostgreSQL/M2M pendiente y la política fiscal sin aprobar.
