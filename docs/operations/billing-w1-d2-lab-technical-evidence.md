# Billing W1-D2 · persistencia M2M v2 en laboratorio

**Fecha:** 2026-10-27. **Base:** `7931071`; rama aislada `codex/billing-w1-d2-lab`. ADR-BIL-011/012 conservan estado **PENDIENTE DE APROBACIÓN FORMAL** y DP-01 sigue sin emisor piloto decidido. Esta rama y su migración son evidencia de laboratorio; `AppModule` no importa `FiscalConsumersLabModule`. Ninguna ruta v2 operativa ni emisión fiscal v2 está activa.

## Implementación y trazabilidad

| SDD | Cambio | Evidencia / límite |
|---|---|---|
| T03 | Cinco tablas aditivas en Prisma y migración `20261114000000_w1_d2_consumer_m2m_lab`: consumidor, mapeo estable con emisor, asociación por ambiente, binding unívoco de clave y reserva v2. `api_keys` admite solo el perfil nuevo adicional; `(id,tenant_id)` soporta FKs compuestas. | V1 conserva `FiscalIntegrationAssociation`, `ApiKeyCompany`, `FiscalIdempotencyKey` y sus filas. Se ensayó solo en contenedor marcado descartable. |
| T03/T05 | Servicio y repositorio de registro idempotente, emisión de secreto una vez con Argon2id, scopes mínimos, ventana explícita de dos claves, expiración de la vieja al terminar la ventana y revocación inmediata. Guard v2 carga binding, consumidor, empresa y ambiente de DB en cada request. | `FiscalConsumersLabModule` no está en `AppModule`; la ruta HTTP de la prueba existe solo dentro del archivo E2E. El servicio de alta no acepta una ruta administrativa productiva. |
| T04 | Reserva **sintética de laboratorio** mediante inserción atómica `ON CONFLICT DO NOTHING` bajo índice único `(association_id,environment,operation,key)`, lookup con hash/version obligatorios, 404 para ausencia o discrepancia, 409 para replay de creación conflictivo. | No calcula hash fiscal canónico, no numera ni crea documentos. La operación sintética no está expuesta por HTTP. |
| T05 | Origen nullable y pareado en `fiscal_documents`, FK compuesta y trigger que vincula consumidor, asociación, empresa y ambiente. Lectura de laboratorio filtra origen exacto y oculta documentos v1/ajenos. | No se habilita lectura v2 de documentos/XML/artefactos; sus rutas y scopes quedan para una wave posterior. |
| T03/T04 | Auditoría creada en la **misma transacción** que registro, clave, revocación y reserva; lookup audita su resultado. Metadata no incluye secreto ni `Idempotency-Key`. | La política final de retención, niveles de acceso y operación de logs requiere revisión de Seguridad/DBA. |

La migración añade restricciones de estado, hash, integridad documento/reserva, tenant/empresa, perfil y ambiente, y protege por trigger la identidad de una clave ya vinculada. Las columnas de origen son `NULL` para documentos históricos; no hay backfill.

## Matriz de validación

| Gate | Comando | Resultado |
|---|---|---|
| Migraciones desde base vacía y seguridad DB | `npm run test:safety:db` | 25/25 migraciones, incluida W1-D2, aplicadas en PostgreSQL descartable; **8/8** seguridad DB. |
| Restricciones, M2M, 100 intentos, replay, rotación, revocación, origen, tenant suspendido y auditoría | `npm run test:e2e:disposable` | **9/9** casos W1-D2 dentro de **27 suites / 162/162** E2E, con cliente Inventori fijado y DB descartable. |
| Contratos v1/v2 y lock de activación | `npm run test:w1:d0` | **33/33** en 6 suites. |
| Unidad completa | `npm test -- --runInBand --silent --testTimeout=30000` | **117 suites, 1338/1338 aprobadas; 13 omitidas preexistentes**. Una primera corrida dio 1 fallo intermitente en el verificador independiente XAdES; su suite aislada pasó 40/40 y la segunda regresión completa pasó. |
| Seguridad estática y general | `npm run test:safety:static`; `npm run test:safety` | PASS y **35/35**. |
| E2E Inventori fijado | `npm run test:e2e:disposable` con cliente Inventori fijado | **27/27 suites, 162/162 pruebas**, incluido W1-D2. |
| Compilación, tipos, lint | `npm run build`; `npm run typecheck`; `npm run lint:check` | PASS; lint con 0 errores y 26 advertencias preexistentes. |

### Reproducción segura

```powershell
# Prisma validate/generate no conecta; use URL marcador no alcanzable si no hay .env local.
$env:DATABASE_URL = 'postgresql://not-used:not-used@127.0.0.1:5432/not_used'
npx prisma validate
npx prisma generate
Remove-Item Env:DATABASE_URL

# Cada comando de DB crea y destruye su propio PostgreSQL etiquetado en tmpfs.
npm run test:safety:db
npm run test:e2e:disposable -- w1-d2-consumer-lab
npm run test:w1:d0
npm test -- --runInBand --silent --testTimeout=30000
npm run test:safety:static
npm run test:safety
npm run typecheck
npm run build
npm run lint:check

# Para E2E completo, asignar INVENTORI_BILLING_CLIENT_PATH a copia del cliente
# fijado edb1e05186d296e3699c71306913f16aee470d1e, SHA-256
# 1bc069fa657569ce3c489b633775adea8ba362bbe3c3f19e0051209c88ea9da0.
npm run test:e2e:disposable
```

El harness `disposable-postgres.mjs` comprueba etiquetas, token y marcador de propiedad antes de limpieza; su `migrate deploy` apunta exclusivamente al URL efímero que acaba de crear. No se proporcionó `DATABASE_URL` de una base objetivo y no se ejecutó DDL fuera de contenedores descartables.

El timeout de 5 s por prueba del comando unitario predeterminado resultó insuficiente para dos arranques Nest en la suite v1 de readiness de este host. La suite aislada pasó 32/32 con `--testTimeout=30000`, sin cambiar aserciones. La primera regresión con ese presupuesto aprobó 1337 pruebas y falló solo en la verificación independiente XAdES de una factura; la suite XAdES aislada pasó 40/40 y la repetición integral pasó 1338. Este comportamiento intermitente queda como riesgo de CI por investigar antes de usar la señal de una sola corrida para autorización de producción.

## Compatibilidad, DBA y riesgos pendientes

- Los 42 pares verbo/ruta v1 y las credenciales Inventori permanecen. El guard v1 sigue rechazando `billing-consumer-v2`; el guard v2 rechaza perfil v1, binding ajeno, tenant/empresa/ambiente equivocado, falta de scope y clave revocada/expirada. La migración no reescribe reservas, claves, XML, `clave`, consecutivos ni asociaciones v1.
- Antes de integrar la migración fuera del laboratorio, DBA debe observar `_prisma_migrations` y checksums de la base objetivo, resolver la historia A/B y clasificar las 16 divergencias W0. Revisar costo y bloqueo de los dos índices sobre `companies` y `api_keys`, `ALTER TABLE api_keys`/`fiscal_documents`, FKs y triggers; aprobar estrategia expand, backup, ventana, rollback de aplicación y reparación hacia adelante. Este ensayo de base vacía no sustituye restore de una base representativa.
- Arquitectura/Seguridad deben aprobar formalmente ADR-BIL-011/012, vida máxima de clave, límite de solapamiento, manejo de secretos, auditoría y retención. El laboratorio exige ventana explícita pero **no fija un máximo normativo**; la clave anterior expira a más tardar al cerrarla. DP-01 y la identidad legal son previos a cualquier vínculo real.
- El hash de reserva W1-D2 es sintético y suministrado por la prueba. Emisión v2 y hash canónico calculado por Billing requieren ADR-BIL-013/decisiones fiscales y una implementación posterior; el método de reserva de laboratorio nunca debe exponerse como creación fiscal.
- `FiscalConsumersLabModule` no implementa ruta admin JWT ni superficies operativas v2. La protección de origen en lecturas de XML, artefactos, notas y feed depende de habilitar esas superficies con scopes propios. STAG y producción no fueron validados.

**Estado:** `W1_D2_LAB_TECHNICAL_PASS` para el laboratorio aislado. No equivale a aprobación de ADR, revisión DBA, STAG ni autorización de producción. No continuar con W2, merge, migración real ni despliegue.
