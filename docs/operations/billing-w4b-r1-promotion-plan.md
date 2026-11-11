# Billing W4-B-R1 — plan de promoción, no autorizado

## Rama y diferencias

- Rama: `codex/billing-spec-af-w4b-r1`; base `3259908ae648e2e730947a4fe8b9c292210dab0e` (R2), que hereda R1 `634114b`/`b0bef77`.
- `main` local al inicio: `e7f8fff87cc1fe1f4122fe6544957ab0c001b757`; ancestro común `3b0893fb02bbe0fb6e51ebcda795a7d1555f3820`. R1/R2 no están en `main`. Un merge directo requiere reconciliación de código y migraciones de ambas líneas.
- Commit de código nuevo: `9e2055361a3d19a720c82c2ad3c0aa80eb72ceb5`; SHA final de la rama al cierre: `HEAD` del commit documental de este plan, consignado en el informe final. La rama histórica de motor correctivo `codex/billing-nc-nd-functional` (`53907fa`) es otra línea, no se fusionó aquí.

## Inventario actual

Nuevo: XSD oficial de NC fijado, metadato, compilación explícita y prueba. La regla de Git conserva bytes XSD en Windows. **Ausentes en R1:** motor NC integrado, DTO y ruta M2M ejecutable, serialización y firma NC, XML firmado que pase XSD, persistencia de relación original→NC, migración, auditoría de solicitud, recuperación y adaptador Afiliaciones. No se cambiaron facturas ordinarias ni migraciones. Migraciones requeridas **para el cambio actual: NO**; para un motor NC futuro: **SÍ**, sujetas a diseño y ensayo descartable.

## Secuencia de promoción propuesta

1. Aprobar DF-06/ADR-BIL-014 para NC total de factura aceptada sin pagos: código de referencia, período, efecto contable y firma/representación. Definir pagos y ND por separado.
2. Revisar el motor histórico v2 y portar solo dependencias necesarias sobre la línea R2; resolver el diff con `main` sin mezclar automáticamente W1–W3 ajenos. Mantener contrato v1 y factura ordinaria mediante pruebas de compatibilidad.
3. Añadir migración aditiva para identidad/referencia fiscal y unicidad, ensayar sobre PostgreSQL descartable y respaldos restaurados autorizados; no tocar ledger instalado.
4. Validar XML NC exento, IVA 0 % explícito, IVA 13 % y dos períodos con XSD oficial, XAdES sintética, identidad original, idempotencia/concurrencia/reinicio y M2M Afiliaciones↔Billing. Probar regresión v1/v2, pagos/Tesorería, permisos y Web.
5. Reconciliar W0-R con versión/ledger instalado; preparar despliegue y rollback de feature flag y código. Las migraciones aditivas no se revierten borrando datos fiscales; ante fallo, desactivar la emisión y conservar historial para conciliación.

`BILLING_MAIN_MERGE_READY = NO`. No hubo push, merge, migración instalada ni despliegue.
