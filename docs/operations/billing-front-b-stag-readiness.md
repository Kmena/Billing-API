# Billing · Frente B · descubrimiento y preparación STAG

**Fecha:** 2026-10-28. **Base:** `e63dbc4`. **Rama de trabajo:** `codex/billing-stag-simple-update`. Este informe distingue el repositorio y las pruebas descartables de un despliegue real. No se accedió a STAG, producción, Hacienda ni a una base objetivo.

## B1 · Inventario comprobado

| Área | Evidencia del repositorio | Estado del despliegue STAG |
|---|---|---|
| Compose | `docker-compose.yml` declara `postgres:15-alpine`, API, worker y LocalStack opcional. El propio archivo se identifica como stack de desarrollo; publica 5432/3000 y usa valores de desarrollo. | Host, orquestador, archivos efectivos y servicios en ejecución desconocidos. Este Compose no se acepta como definición STAG. |
| API y workers | Imagen Node 24, API `/health`; worker con health de proceso `kill -0 1`. API y worker comparten DB, almacenamiento fiscal y store cifrado. | Réplicas, digests, supervisión de colas y readiness real no verificados. El health del worker solo prueba vida del proceso. |
| PostgreSQL | Volumen nombrado `postgres_data` en desarrollo; Prisma tiene 27 directorios de migración. | Instancia, versión, historial `_prisma_migrations`, backups y capacidad de restore desconocidos. |
| Variables y secretos | `.env.local.example` contiene ejemplos de desarrollo; `config.validation-schema.ts` exige origen CORS explícito en staging/production. Compose monta una clave maestra desde archivo del operador, separado del store cifrado. | No hay archivo de entorno STAG revisado ni rutas/propietarios autorizados. No se inspeccionaron valores secretos. |
| Datos persistentes | `./storage` guarda artefactos fiscales; `./secrets-storage` guarda secretos cifrados; la clave vive fuera de ambos. | Montajes, retención, instantáneas, permisos y custodia de clave en STAG no verificados. |
| Git | `main` local en `b6c454f`, `origin/main` local en `6b9fa8a`; `e63dbc4` no es ancestro de ninguno. | Checkout y remote del servidor desconocidos. No se hizo fetch a un remote externo. La actualización real requiere primero integrar y aprobar un SHA de `main` por vía separada. |
| Respaldo | Hay utilidades de backup/restore con hash para artefactos y store cifrado; no hay ejecutor de backup PostgreSQL de STAG configurado. | Calendario, destino, retención, prueba periódica y recuperación de configuración no verificados. |

**Conclusión del descubrimiento:** no hay evidencia suficiente para afirmar qué está desplegado en STAG. Operaciones debe aportar topología, configuración efectiva sanitizada, identidad de host/cluster, digests, montajes, observabilidad y procedimiento de backup/rollback. No se asumen rutas ni credenciales.

## B2 · Preflight DBA

`DATABASE_URL`, `DIRECT_URL`, `BILLING_TARGET_DATABASE_URL` y `BILLING_STAG_DATABASE_URL` no están presentes en esta sesión; tampoco hay `.env` o `.env.local` en el worktree. **`DBA_TARGET_PREFLIGHT=BLOCKED_NO_AUTHORIZED_CONNECTION`**. No se ejecutó consulta ni DDL sobre una base objetivo.

El DBA debe ejecutar [la consulta de solo lectura](billing-w1-d0-dba-readonly.sql) con acceso autorizado, conservar salida sanitizada y comparar cada una de las **27** migraciones del árbol por nombre, SHA-256, orden, `finished_at` y `rolled_back_at`. Debe investigar filas ajenas, incompletas y la migración histórica A con SQL no recuperado, sin fabricar registros ni usar `migrate resolve`. Después debe confirmar o refutar en el objetivo las **16** tablas del [diff W0 descartable](billing-w0-prisma-effective-diff.txt): `api_keys`, `audit_logs`, `companies`, `company_economic_activities`, `fiscal_branches`, `fiscal_documents`, `fiscal_idempotency_keys`, `fiscal_integration_associations`, `fiscal_issuance_points`, `fiscal_sequences`, `fiscal_terminals`, `fiscal_xml_artifacts`, `hacienda_connections`, `refresh_tokens`, `tenants` y `users`. Para cada diferencia se requiere definición efectiva, impacto funcional, clasificación nominal o semántica, responsable y decisión. El [informe W3-B](billing-w3-b-dba-preflight.md) detalla los riesgos de las tres migraciones W1–W3. Solo después procede ensayar SQL exacto sobre un restore descartable representativo y aprobar una ventana separada. No hay plan de reconciliación ejecutable sin esa evidencia.

## B3/B4 · Actualización y recuperación

`scripts/billing-update` conserva la operación futura `sudo billing-update`. El controlador fija STAG, SHA aprobado de `main`, checkout limpio y fast-forward; exige comprobación de configuración, preflight de migraciones, backup con manifiesto regular y no vacío, restore verificado, actualización API/worker y health. Se detiene al primer fallo, impide aplicación concurrente y registra estado, fase y SHA sin copiar stdout/stderr de ejecutores. Los siete ejecutores son contratos locales de operaciones y aún no existen para el destino; el [runbook](billing-w0-w3-update-runbook.md) define su interfaz. No se instaló el comando ni se actualizó servidor alguno.

Pruebas realizadas:

- Git efímero y ejecutores de servicio simulados: actualización aprobada y fallos de migración, API, worker y health registrados; se comprueba que no corren fases posteriores.
- PostgreSQL `postgres:15-alpine` aislado, sin red, puerto ni volumen persistente: `pg_dump -Fc` sintético, SHA-256 `3ed699f44a5c7e27b921307a7524b62658718043b95b64b0f362ef3b93b2698c`, `pg_restore` a otra base y comparación de 2 filas: PASS. El contenedor fue eliminado.
- Artefactos fiscales sintéticos: backup y restore aislado de 2 archivos, hashes iguales: PASS. Configuración sintética: copia y recuperación con hash igual: PASS.
- Store cifrado: suite existente 12/12 PASS, incluidos backup/restore con clave separada, corrupción y clave incorrecta. No se creó ni respaldó una clave real.

Estos resultados prueban el mecanismo local, no un punto de recuperación de STAG. Antes del despliegue, operaciones debe demostrar backup PostgreSQL del objetivo, integridad del archivo, restore en base descartable, referencias fiscales hacia los objetos restaurados, configuración recuperable y custodia separada de la clave maestra. El backup de configuración debe excluir credenciales; los secretos quedan en almacén protegido y nunca en Git o logs.

## B5 · Secuencia de habilitación STAG pendiente

1. Registrar topología real, entorno y responsables; separar DB, artefactos, store cifrado, clave, DNS, red y credenciales de producción. Confirmar CORS explícito y egress a endpoints STAG únicamente.
2. Obtener lectura DBA autorizada, reconciliar 27 migraciones y 16 divergencias; aprobar cualquier DDL en proceso separado. Mantener rutas v2 inactivas.
3. Probar backup/restore y recuperación de configuración en STAG descartable; fijar SHA de `main`, digests API/worker y prueba de rollback de binarios compatible con el esquema.
4. Instalar los siete ejecutores revisados y ensayar `billing-update` en STAG autorizado; verificar `/health`, proceso y colas del worker, montajes, secretos y contratos v1. Detener ante cualquier fallo y conservar evidencia.
5. Solo con autorización fiscal y de despliegue separadas, validar FE/NC/ND por escenario con Hacienda STAG y después decidir activación controlada de v2. No se hizo conexión a Hacienda en este frente.

## B6 · Gates al cierre técnico local

| Gate | Estado | Motivo |
|---|---|---|
| `SIMPLE_UPDATE_READY` | `PASS_LAB_TARGET_BLOCKED` | Script y fallos simulados probados; ejecutores y checkout STAG ausentes. |
| `BACKUP_RESTORE_READY` | `PASS_DISPOSABLE_TARGET_BLOCKED` | PostgreSQL, artefactos, configuración y secretos sintéticos verificados; restore objetivo pendiente. |
| `DBA_TARGET_PREFLIGHT` | `BLOCKED_NO_AUTHORIZED_CONNECTION` | Sin lectura de ledger ni esquema objetivo. |
| `STAGING_INFRASTRUCTURE_READY` | `BLOCKED_UNVERIFIED_TOPOLOGY` | No hay evidencia del despliegue efectivo ni aislamiento. |
| `STAGING_DEPLOYMENT_AUTHORIZATION` | `NOT_GRANTED` | Ningún despliegue solicitado o autorizado. |
| `PRODUCTION_READINESS` | `NOT_READY` | DBA, STAG, decisiones fiscales y autorización pendientes. |

Validación local: `billing-update.test.mjs` 6/6, `billing-update.integration.test.mjs` 3/3, respaldo/restauración descartables PASS, secretos cifrados 12/12, contratos W1-D0 42/42, `npm run build` PASS, `npm run lint:check` 0 errores y 26 advertencias preexistentes. El primer build dentro del sandbox falló al crear `dist`; se repitió con permiso de escritura y pasó. No se ejecutó actualización, migración ni activación fiscal real.
