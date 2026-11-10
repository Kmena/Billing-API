# Baseline operativa estable de Billing

Fecha: 2026-11-10, 11:38 hora de Guatemala. Estado: `BILLING_STABLE_BASELINE_RECORDED`.

Este inventario registra el estado local después de la [recuperación operativa](billing-operational-recovery-20261110.md) y del [endurecimiento de disponibilidad](billing-recovery-hardening-20261110.md). Es una fotografía de los contenedores y respaldos, no una autorización para emitir documentos fiscales ni para iniciar un despliegue. No se cambiaron imágenes, contenedores, bases, credenciales, banderas fiscales, Afiliaciones ni Inventori al registrar esta baseline.

## Imágenes instaladas y políticas

El identificador `sha256` de la tabla es el **ID de imagen local instalado**. Para las imágenes locales de Billing no hay `RepoDigests` publicados; su ID y revisión OCI son las huellas verificables disponibles. Las imágenes PostgreSQL sí tienen digest de repositorio.

| Servicio / contenedor | Etiqueta instalada | ID de imagen local | Revisión OCI o digest de repositorio | Reinicio / salud actual |
| --- | --- | --- | --- | --- |
| Billing v1 API, `billing-api` | `billing-final-local-candidate:20261013` | `sha256:a4a02cbc69eb192187145286cdb008827b0006f7e77b66f2ae258087414f187e` | Revisión `3b0893fb02bbe0fb6e51ebcda795a7d1555f3820` | `unless-stopped` / `healthy` |
| Billing v1 worker, `billing-worker` | Misma imagen v1 | `sha256:a4a02cbc69eb192187145286cdb008827b0006f7e77b66f2ae258087414f187e` | Misma revisión v1 | `unless-stopped` / `healthy` |
| PostgreSQL v1, `billing-postgres` | `postgres:15-alpine` | `sha256:aad6289ca337b3ce76896f2e7e61480490152886c7828120371fb28e6b779e1d` | `postgres@sha256:fe0737ba566a2c5b2a28f34433c0a423261900ec17b9bf7ad115e1aae7e57f1b` | `unless-stopped` / `healthy` |
| Billing SANDBOX documental, `spec09-billing-billing-spec09-sandbox-1` | `billing-spec10:documents-install-20261106` | `sha256:eba8ab4c0e927f840b085bd92da4609bf7f0af34d672193f73af0d82fda3a1fb` | Revisión `45b3c07daef701a14efac264dc1daff2692a6ac6` | `unless-stopped` / `healthy` |
| PostgreSQL SANDBOX, `spec09-billing-postgres-1` | `postgres:16-alpine` | `sha256:fff3594bf464bea0f502788874403882d8bbbe618b3250f8649e7e42fd118020` | `postgres@sha256:16bc17c64a573ef34162af9298258d1aec548232985b33ed7b1eac33ba35c229` | `unless-stopped` / `healthy` |

Las políticas SANDBOX `restart: unless-stopped` están en la capa base PostgreSQL (`scripts/spec09-sandbox/compose.billing.yaml` del worktree histórico) y la capa final documental (`scripts/spec10/compose.billing.documents-read.yaml` del worktree histórico). Se aplicaron también a los **contenedores existentes** mediante `docker update`; sus IDs de contenedor e imagen no cambiaron. Billing v1 ya usaba `unless-stopped` y no fue modificado. Los hashes SHA-256 de las dos capas finales son `9a7e1b9634392f46a3d041d3b5948e9dbc71191bc972f17944aeb363b3736024` y `5186304de79c301bde4e093c5ab13bc22c446cb2e85c93435e208f3464093d25`, respectivamente. La configuración combinada de 16 capas pasó `docker compose config --no-interpolate` en el endurecimiento.

## Commits de la baseline

| Commit local | Repositorio / rama | Contenido |
| --- | --- | --- |
| `4f539eb049ec287ef699574cad62207ab6c0ab8f` | Afiliaciones, `codex/spec10-stable-fiscal-event` | `restart: unless-stopped` del PostgreSQL SANDBOX en su Compose histórico. |
| `d81a5300cb30fb7f95513898fec2dbf7128ad77f` | Billing, `codex/spec10-local-install-billing` | `restart: unless-stopped` de la API SANDBOX en la capa documental. |
| `df1d6da657f464c2bd28f49865d6296d829820ce` | Billing, `7-conexion_m2m` | Actas de recuperación y endurecimiento, y script de respaldo DPAPI de llave maestra. |

No se hizo merge ni push. El worktree principal de Billing conserva cambios preexistentes sin confirmar, ajenos a esta baseline.

## Respaldos verificados fuera de Docker y de los worktrees

El directorio privado `D:\SPEC09-Install-20261104-1555\recovery-20261110` tiene ACL limitada a `SYSTEM` y la cuenta Windows autorizada. Su contenido se conserva sin modificar:

| Respaldo | SHA-256 | Verificación |
| --- | --- | --- |
| `spec09-billing-pgdata-cold.tar` | `36bba127f28c8f1102c968b6f79132f319b9eb567d64164a04454ae7c4e28b38` | Copia fría; listado TAR comprobado durante la recuperación. Hash reconfirmado al registrar esta baseline. |
| `spec09-billing-current.dump` | `efaef07a1f924e48ca927fc27d692dbac142f77aaa9932f4c4d69eea21a3009b` | `pg_restore -l` válido durante la recuperación. Hash reconfirmado. |
| `spec09-billing-master-key.dpapi` | `0c39bce6b49c50185444f5e844e2d8cc0c46b129af2fb205fb8b8337bcce9d4c` | Manifiesto privado `restoreTest=PASS`: restauración en volumen descartable sin red y coincidencia SHA-256. Hash cifrado reconfirmado. Alcance DPAPI `CurrentUser`. |
| `billing-stable-baseline-20261110/manifest.json` | `af8c6de80668d1a6db18c7edb8f6eeb0277b19af8c2ab9ff8bbb202b949ad14d` | Copias de las **16 capas Compose**, bootstrap documental, dos actas, script de respaldo y tres archivos TLS privados: **23 archivos**, cotejados individualmente con su origen por SHA-256. |

Las copias previas al cambio de política Compose también permanecen en el mismo directorio como `compose.billing.before-hardening.yaml` y `compose.billing.documents-read.before-hardening.yaml`. El manifiesto del paquete conserva el orden exacto de las 16 capas y su ruta de origen. Las capas 1 y 16 archivadas son las versiones **posteriores** al endurecimiento; sus hashes coinciden con los archivos que siguen operativos. El bootstrap archivado tiene SHA-256 `ad8403b220cd12f0c63b0d038886b6ea4d089776fcf08d68dce9d31a5afcd5cc`. Los archivos TLS y sus hashes se mantienen solo en el manifiesto privado; no se copian a Git.

**Dependencia aún vigente:** las etiquetas Compose y los montajes actuales del contenedor apuntan a rutas de worktrees para algunas capas, el bootstrap y TLS. El paquete externo permite recuperar esos archivos si se pierde un worktree, pero **no cambia los montajes de un contenedor existente**. No borrar esos worktrees hasta reubicar los montajes en una intervención autorizada y verificada. La copia DPAPI depende de la misma cuenta/perfil Windows y no demuestra recuperación en otro equipo.

## Matriz de salud y dependencias

Estado observado al registrar la baseline. `healthy` proviene del healthcheck Docker; las consultas funcionales indican expresamente cuándo se verificaron por última vez.

| Componente | Salud actual | Dependencias y alcance comprobado |
| --- | --- | --- |
| Billing v1 API y worker | Ambos `healthy` | PostgreSQL `billing-postgres` `healthy`, red `billing_default`; volúmenes de llave y secretos cifrados. API v1 `/health/ready` HTTP 200 en la recuperación operativa. No se repitieron M2M de Inventori en esta baseline. |
| Billing v1 PostgreSQL | `healthy` | Volumen `billing_postgres_data`; 25 migraciones y 3 documentos constatados en la recuperación. Sin consultas nuevas de conteos en este registro. |
| Billing SANDBOX documental | `healthy`; su healthcheck llama `/health/ready` y la última ejecución devolvió código 0 | PostgreSQL SANDBOX; redes `spec09_billing_backend` y `aflilientions_internal`; volúmenes `spec09_billing_master_key`, `spec09_billing_secret_store`, `spec09_billing_fiscal_storage`; bootstrap y TLS montados desde worktrees. M2M y lectura de dos XML históricos se verificaron en la recuperación; un GET documental se repitió en el endurecimiento. |
| PostgreSQL SANDBOX | `healthy` | Volumen `spec09_billing_pgdata`; 32 migraciones, 2 documentos, 2 envíos, 2 entregas, 4 artefactos y 46 auditorías sin variación en el endurecimiento. No se ejecutaron migraciones en esta baseline. |
| Afiliaciones API | `healthy`; `/health/ready` es su healthcheck | PostgreSQL `aflilientions-postgres-1` `healthy`; redes `aflilientions_internal` y `billing_default`. Su consulta documental histórica a Billing SANDBOX se verificó antes de esta baseline. El flujo de factura previa con Billing v1 permanece desactivado; la red permite esa integración cuando se autorice. No se cambiaron credenciales ni servicios. |
| Afiliaciones Web y puerta LAN | Web `running` sin healthcheck propio; puerta `healthy` | Web depende de API; puerta LAN expone la aplicación. La navegación de Facturación y Pagos fue confirmada previamente por el operador; no se repitió en esta baseline. |
| Inventori API | `unhealthy` (preexistente) | Red `billing_default` y otros servicios de Inventori. La integración con Billing v1 se preservó; no se ensayó E2E ni se modificó Inventori. |

El SANDBOX documental conserva `USE_REAL_HACIENDA=false`, `EMAIL_USE_REAL=false`, `FISCAL_WORKER_ENABLE_IN_TESTS=false`, `BILLING_SPEC09_STAG_INVOICING=false` y `SPEC10_DOCUMENTS_READ=true` según el preflight de endurecimiento. En esa fase no aumentaron envíos ni entregas. Esta baseline no generó facturas, correos ni tráfico fiscal.

## Recuperación y prueba pendiente

1. **Verificación inmediata tras un reinicio del motor:** comprobar que los cinco contenedores Billing de la tabla conservan imagen, volúmenes, `RestartPolicy.Name=unless-stopped` y salud; para SANDBOX esperar PostgreSQL `healthy` antes de evaluar API. Comprobar `/health/ready`, una lectura M2M de configuración y XML histórico, y comparar conteos y hashes con las actas. Una detención intencional queda detenida con `unless-stopped`.
2. **Si falta un archivo Compose o bootstrap de worktree:** usar el manifiesto privado y las copias numeradas en `billing-stable-baseline-20261110`; cotejar cada SHA-256 y restaurar en la ruta de origen adecuada antes de usar Compose. Mantener el orden de las 16 capas. No ejecutar `docker compose up` a ciegas: puede recrear servicios; comparar primero la configuración efectiva y sus montajes. Los TLS privados solo se recuperan desde el paquete protegido.
3. **Si falla la base:** conservar los volúmenes actuales y consultar el acta de recuperación; verificar el dump con `pg_restore -l` y la copia fría antes de ensayar restauración en un volumen/base descartable. Toda restauración sobre datos instalados requiere autorización específica. No ejecutar Prisma Migrate ni editar el ledger.
4. **Si falta la llave:** verificar el hash del archivo DPAPI y el manifiesto, descifrar bajo la misma cuenta Windows solamente en memoria y ensayar restauración a un volumen nuevo con permisos `0400`, como se documentó en el endurecimiento y en `scripts/backup-spec09-master-key.ps1`. No restaurar encima de un volumen poblado, crear otra llave ni rotar credenciales sin autorización.

**Pendiente explícito:** no se reinició Docker Desktop de forma completa, porque requiere autorización específica. Por tanto, el reinicio automático está verificado en política runtime y Compose persistente, pero no mediante una prueba real de reinicio del motor. Tampoco se probó recuperación en otra máquina ni la reubicación de los montajes fuera de los worktrees.
