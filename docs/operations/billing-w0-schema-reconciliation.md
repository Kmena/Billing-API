# W0 · reconciliación de Prisma y migraciones

Fecha: 2026-10-27. Rama: `codex/billing-w0`. Se usó únicamente PostgreSQL 15 efímero provisto por `scripts/test-safety/disposable-postgres.mjs`; el contenedor usa `tmpfs`, rol sin privilegios de creación, marcador de propiedad y destrucción validada por etiqueta. No se consultó ni migró una base normal o productiva.

## Evidencia reproducible

```powershell
$env:DATABASE_URL = 'postgresql://w0:w0@127.0.0.1:1/w0_no_connect'
npx prisma validate
Remove-Item Env:DATABASE_URL
npm run test:w0:schema
npm run test:db-regression:disposable
```

Para regenerar el diff revisable, asignar `BILLING_W0_DIFF_OUTPUT` a una ruta local antes de `npm run test:w0:schema`. El manifiesto `billing-w0-migration-manifest.json` contiene las 24 rutas ordenadas y el SHA-256 de cada `migration.sql`. `.gitattributes` obliga LF en esos SQL y en los XSD fijados, porque los checksums dependen de bytes exactos. Ningún SQL de migración cambió frente al blob Git; el hash de `20261110000000_make_fiscal_idempotency_rotation_safe` sigue `ea43d0566814497ae1bd0ca5b37905c6d9215098f90cf33046897b26ec9dd7cf`.

La ejecución descartable dio 24 migraciones aplicadas, 24 checksums idénticos al manifiesto, cero pendientes y `prisma migrate status` actualizado. En el esquema efectivo se verificó el índice único `(tenant_id, company_id, operation, key)`, la ausencia del índice histórico que incluía `api_key_id`, la presencia del índice de auditoría para `api_key_id` y la nulabilidad de esa columna. Las 12 pruebas de concurrencia F3/F4 pasaron con la misma clase de base descartable.

## Divergencias detectadas

`prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code` devolvió código 2 tras aplicar toda la historia. El diff íntegro está en `billing-w0-prisma-effective-diff.txt` y afecta 16 tablas. La salida es una propuesta de cambio generada por Prisma, **no** un plan de migración aprobado.

| Clase | Evidencia | Tratamiento |
|---|---|---|
| Defaults y tipos | `api_keys.scopes`, varios `updated_at`, columnas de tiempo, `fiscal_idempotency_keys.operation` | Revisar intención de schema y SQL histórico con DBA; no quitar defaults ni convertir tipos en W0. |
| Claves foráneas | Prisma propone quitar y agregar FKs en `audit_logs`, `fiscal_issuance_points`, `hacienda_connections` y `refresh_tokens` | Comparar `ON DELETE/UPDATE`, nulabilidad y nombres antes de decidir si hay diferencia semántica. |
| Nombres de índices | Prisma propone renombrar índices de actividades, sucursales, documentos, asociaciones, secuencias, terminales y XML | Evaluar como divergencia nominal separada; conservar índices efectivos hasta revisión. |

La comparación de un esquema fresco no certifica el estado actual de la base normal. El runbook `fiscal-idempotency-migration-reconciliation.md` documentó el 2026-10-11 una migración A aplicada en la base normal cuyos bytes originales no se recuperaron, una migración de compatibilidad aplicada y B pendiente. Es evidencia histórica; W0 no releyó esa base y no puede afirmar si B sigue pendiente hoy. Antes de W1 con DDL real, DBA debe hacer preflight en solo lectura del registro `_prisma_migrations`, checksums, duplicados, índices, FKs y backups; decidir explícitamente cómo tratar el diff de 16 tablas. No se debe fabricar A ni usar `migrate resolve` para ocultar la procedencia.

Resultado T02: historia y esquema crítico verificados en DB descartable; divergencias datamodel/SQL y estado de la base normal documentados para revisión. Ningún gate de producción queda autorizado.
