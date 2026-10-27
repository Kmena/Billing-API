# W1 · plan de esquema y revisión DBA

**Estado:** PROPUESTO; no contiene SQL ejecutable ni autoriza migración. W0 aplicó 24 migraciones **solo** en PostgreSQL descartable y halló [diff efectivo de 16 tablas](../operations/billing-w0-prisma-effective-diff.txt). El estado actual de la base normal no se leyó en W0. El [antecedente de idempotencia](../operations/fiscal-idempotency-migration-reconciliation.md) registra una migración histórica A aplicada cuyo SQL exacto no se recuperó; no se reconstruye ni se oculta.

## 1. Clasificación DDL / sin DDL

| Cambio de W1 | DDL | Condición |
|---|---|---|
| OpenAPI, fixtures sintéticos, catálogo de scopes, contrato de errores y prueba de routing v1/v2 | No | Puede prepararse sin ADR fiscal ni topología real. |
| Guard/DTO v2, autorización por principal sintético y pruebas negativas unitarias | No, si no se activa ni persiste | No registrar rutas operativas hasta aprobar ADR-BIL-011/012; preservar guard v1. |
| `FiscalConsumer`, `FiscalConsumerAssociation`, `FiscalConsumerKeyBinding` | Sí, tablas/FKs/únicos nuevos | ADR-BIL-011 aprobado; tenant/empresa/key vinculados por restricciones DB. |
| `FiscalIdempotencyKeyV2` | Sí, tabla/único/FKs nuevos | ADR-BIL-012 aprobado; no tocar índice ni filas de `FiscalIdempotencyKey` v1. |
| `FiscalDocument.originConsumerId?`, `originAssociationId?` e índice | Sí, columnas/FKs/índice aditivos | `NULL` para legado; sin backfill inferido; servicio v2 exige ambos. |
| Índices `(id,tenant_id)` de soporte para FKs compuestas en `companies` y `api_keys` | Sí, sobre tablas existentes | DBA decide forma exacta; validar tamaño, bloqueo y concurrencia. |
| Alta de una clave v2 con `integrationProfile='affiliations-fiscal-v1'` | No DDL en `api_keys` | Requiere nuevos modelos y perfil/guard aprobados; secreto mostrado una vez. |
| Representación de líneas en OpenAPI y golden fixtures | No | Diseño W2; no emitir ni persistir líneas v2 antes de ADR-BIL-013/DF. |
| Alta de asociaciones para un emisor real | DML real, fuera de este plan técnico | DP-01, responsable y ventana autorizados; W1 diseño no la ejecuta. |

## 2. Impacto del diff Prisma W0, tabla por tabla

`prisma migrate diff` devuelve una propuesta mecánica, no evidencia de que cada diferencia deba corregirse. La columna “impacto W1” distingue tocar una tabla de depender de su estado.

| Tabla en diff | Diferencia W0 | Impacto W1 | Revisión antes de DDL |
|---|---|---|---|
| `api_keys` | Default de scopes; tipos de tiempo; `updated_at` | **Directo:** binding por key, eventual índice compuesto | Confirmar hash/estado/ambiente, default y tipo; no aprovechar W1 para alterar scopes v1. |
| `audit_logs` | FKs y `created_at` | Atribución de eventos W1 sin cambio necesario de tabla | Verificar `ON DELETE/UPDATE`; no usar diff automático. |
| `companies` | Tipos de tiempo y default `updated_at` | **Directo:** FK de asociación y posible índice compuesto | Confirmar identidad legal, unicidad y costo de índice. |
| `company_economic_activities` | Nombre de índice | Sin DDL W1 | Clasificar como nominal/semántico por definición exacta. |
| `fiscal_branches` | Tiempos e índices | Sin DDL W1 | No tocar numeración/configuración compartida. |
| `fiscal_documents` | Nombres de índices | **Directo:** dos columnas de origen, FK e índice | Comprobar tamaño, valores v1 nulos, rutas por ID y plan de rollback. |
| `fiscal_idempotency_keys` | Default de `operation` | **Preservar v1:** W1 crea otra tabla | Comparar default efectivo; no cambiar unicidad ni filas históricas. |
| `fiscal_integration_associations` | Tiempos e índices | **Preservar v1:** nueva asociación separada | Confirmar `company_id @unique` y checksums; sin backfill destructivo. |
| `fiscal_issuance_points` | FKs e índices | Sin DDL W1; readiness depende de ella | Confirmar acciones FK; no reasignar puntos. |
| `fiscal_sequences` | Nombres de índices | Sin DDL W1 | Un emisor conserva su secuencia legal; W1 no numera. |
| `fiscal_terminals` | Tiempos e índices | Sin DDL W1 | No cambiar estado de terminales. |
| `fiscal_xml_artifacts` | Nombre de índice | Lecturas futuras vía origen del documento | Confirmar índice sin renombrarlo por comodidad. |
| `hacienda_connections` | FKs, tiempos, índices | Solo readiness; ninguna escritura M2M ordinaria | Revisar FK y secreto referenciado, no alterar credenciales. |
| `refresh_tokens` | FK y tiempos | Sin DDL W1 | JWT admin existente; no mezclar auth de usuario y M2M. |
| `tenants` | Tiempos y `updated_at` | Referencia FK de consumidor nuevo | Confirmar tenant activo y política FK. |
| `users` | Tiempos y `updated_at` | JWT admin existente | No modificar semántica de roles. |

## 3. Secuencia de ensayo y gate DBA

1. **Preflight en solo lectura de la base objetivo por DBA autorizado:** inventario de `_prisma_migrations` (nombre, checksum, finalización, rollback), migración A histórica, B y compatibilidad; comparar con [manifiesto W0](../operations/billing-w0-migration-manifest.json). Extraer definiciones efectivas de índices/FKs/defaults/tipos, comprobar duplicados lógicos, cardinalidad de tablas y objetos ajenos. No usar `migrate resolve` para “normalizar” metadatos.
2. **Clasificar cada diferencia de las 16 tablas:** nominal, representación Prisma o diferencia funcional. Registrar dueño, decisión y evidencia. Si B sigue pendiente, seguir el runbook histórico y su preflight; W1 no salta ese gate.
3. **Aprobar ADR-BIL-011/012 y DP-01:** congelar diagrama, unicidad, FKs, request hash y piloto. Preparar migración **expand** aditiva. No incluir cambios de defaults, tipos o FKs históricas no relacionados solo porque el diff los sugiera.
4. **Ensayo en restore descartable autorizado:** aplicar historia exacta y migración W1, verificar 24 checksums históricos, nuevas FKs/únicos y `NULL` en docs v1; ejecutar cliente Inventori fijado, 42 rutas, E2E multi-consumidor, carreras de idempotencia, rotación/revocación. Medir locks/tiempo y comprobar que `clave`, consecutivos, reservas y artefactos históricos conservan fingerprint.
5. **Rollback de aplicación:** desactivar rutas v2 y volver al binario compatible con columnas/tablas adicionales; no borrar filas v2 ni bajar índices con datos. Si falla una postcondición de DB, plan de reparación hacia adelante y restore ensayado, sujeto a DBA.
6. **Aplicación a un entorno real:** queda fuera de W1 diseño y requiere autorización separada de DBA/operación, backup, ventana y plan de observación. `STAG` y producción tienen gates posteriores distintos.

### Invariantes de migración

- Ninguna fila v1 cambia de `companyId`, `requestHash`, `key`, `consecutive`, `clave` o XML firmado.
- No se reescribe ni se clona `FiscalIntegrationAssociation` para derivar un segundo consumidor. Inventori sigue asociado por su tabla histórica.
- Unicidad v2 debe impedir duplicado en carrera real, además de la comprobación de servicio.
- DBA debe revisar si `externalCompanyKey` se considera global por consumidor o por ambiente; mientras esté pendiente no se admite remapeo silencioso entre SANDBOX y PRODUCTION.
- `originConsumerId` y `originAssociationId` son ambos nulos para legado y ambos presentes para documentos v2; la aplicación y una restricción DB compatible con v1 deben asegurar coherencia.
- No se emiten claves o consecutivos desde una reserva W1 de prueba.
