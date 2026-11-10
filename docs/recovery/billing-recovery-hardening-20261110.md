# Protección de disponibilidad de Billing SANDBOX

Fecha local: 2026-11-10. **Resultado: `BILLING_RECOVERY_HARDENING_PASS`**. No se reinició Docker Desktop, no se recrearon contenedores, no se ejecutaron migraciones y no se cambiaron credenciales ni datos fiscales. Los servicios, código de aplicación y datos de Billing v1, Afiliaciones e Inventori permanecieron intactos. El Compose específico de Billing SANDBOX alojado en un worktree de Afiliaciones sí recibió la línea de reinicio solicitada.

## Alcance y decisión de reinicio

Los contenedores `spec09-billing-postgres-1` y `spec09-billing-billing-spec09-sandbox-1` estaban `healthy`, con política `restart=no`. El Compose base no declaraba `restart`, por lo que Docker aplicaba `no`. El SANDBOX documental actual tiene `USE_REAL_HACIENDA=false`, `EMAIL_USE_REAL=false`, `FISCAL_WORKER_ENABLE_IN_TESTS=false`, `BILLING_SPEC09_STAG_INVOICING=false`, `SPEC10_SINGLE_EMAIL=false` y `SPEC10_DOCUMENTS_READ=true`. Su bootstrap bloquea configuraciones distintas y no ejecuta migraciones. No se identificó una razón para mantener `restart=no` **en esta configuración de solo lectura**.

Se agregó solo `restart: unless-stopped` a:

| Servicio | Compose que lo administra | Commit local | SHA-256 final |
| --- | --- | --- | --- |
| PostgreSQL SANDBOX | `C:\Users\kmena\.codex\worktrees\spec09-docker-frontend-candidate\Aflilientions\scripts\spec09-sandbox\compose.billing.yaml` | `4f539eb` | `9a7e1b9634392f46a3d041d3b5948e9dbc71191bc972f17944aeb363b3736024` |
| API documental SANDBOX | `C:\Users\kmena\.codex\worktrees\spec10-billing-documents\Billing\scripts\spec10\compose.billing.documents-read.yaml` | `d81a530` | `5186304de79c301bde4e093c5ab13bc22c446cb2e85c93435e208f3464093d25` |

El Compose completo de **16 capas** pasó `docker compose config --no-interpolate`; ambas políticas efectivas son `unless-stopped` y la imagen API sigue siendo `billing-spec10:documents-install-20261106`. Copias previas, con hash verificado, quedaron en `D:\SPEC09-Install-20261104-1555\recovery-20261110\compose.billing.before-hardening.yaml` (SHA-256 `a9e6bbfe44f783dc5cfd2a4724a3b79a6cfc840663ffc79ac11960bfd24d2b5f`) y `compose.billing.documents-read.before-hardening.yaml` (SHA-256 `5d84098fcd6fa9cc20cf83e505cca41de826ad48c3feb05a9dea806512ee7dd0`). Los diffs de cada archivo contienen **una sola línea añadida**. No se editaron secretos ni otras opciones Compose.

`docker update --restart unless-stopped` aplicó la política a los **dos contenedores existentes**. Sus IDs e imágenes no cambiaron y ambos siguieron `healthy`; no se hizo `docker compose up`. Billing v1 mantuvo API y worker `healthy`, digest `sha256:a4a02cbc69eb192187145286cdb008827b0006f7e77b66f2ae258087414f187e`, sin cambios.

## Respaldo externo de llave maestra

La llave original de 32 bytes está en el volumen `spec09_billing_master_key`, montado en la API como `/run/spec09-key` **solo lectura**. El script operativo [`scripts/backup-spec09-master-key.ps1`](../../scripts/backup-spec09-master-key.ps1) leyó sus bytes en memoria por `docker exec`, los cifró con DPAPI `CurrentUser` y escribió exclusivamente el cifrado en `D:\SPEC09-Install-20261104-1555\recovery-20261110\spec09-billing-master-key.dpapi`, fuera de Docker y Git. SHA-256 del archivo cifrado: `0c39bce6b49c50185444f5e844e2d8cc0c46b129af2fb205fb8b8337bcce9d4c`. El directorio y archivo tienen ACL solo para `SYSTEM` y la cuenta Windows autorizada. El script rechaza destinos dentro de cualquier repositorio Git; el guardia de ruta y su sintaxis pasaron validación.

El manifiesto privado `spec09-billing-master-key.manifest.json` registra el hash cifrado, huella de la llave original, imagen y volumen de origen, y `restoreTest=PASS`. El archivo DPAPI se abrió bajo la misma cuenta y la llave se restauró **solo en un volumen Docker descartable**, sin red; el SHA-256 restaurado coincidió con el original. El volumen de ensayo fue eliminado. La primera prueba detectó que faltaba `-i` en el contenedor de restauración; se corrigió y la prueba final pasó. Nunca se imprimió ni registró la llave, ni se copió en texto claro a disco. No se cambió ni rotó la llave original.

**Límite:** DPAPI `CurrentUser` permite recuperar bajo el mismo perfil de Windows; esta copia es independiente de Docker, pero no demuestra restauración en otra máquina o sin ese perfil. Una copia portable requeriría un gestor de secretos autorizado y otra validación.

## Validación final

| Comprobación | Resultado |
| --- | --- |
| Healthchecks SANDBOX PostgreSQL y API | Ambos `healthy`; contenedores e imágenes originales intactos. |
| `/health/ready` | SANDBOX y Billing v1 respondieron HTTP `200` también después de aplicar la política. |
| M2M y documentos | Desde Afiliaciones, GET de configuración y documento histórico `817f1bd8-0092-4661-9064-e7f69d18b5b6` pasó. XML firmado de 7 601 bytes con SHA-256 `e5eaac5796ed75ecc6c018d5462e11048903c32ea8a4c5f14e2f24562205da4f`, igual a la base. No se imprimió la credencial. |
| Integridad de datos SANDBOX | Antes y después: 2 documentos, 2 envíos, 2 entregas, 4 artefactos, 46 auditorías y 32 migraciones terminadas. |
| Hacienda y correo | Banderas reales en `false`; worker de pruebas desactivado; cero envíos o entregas nuevos persistidos. |

No se simuló un reinicio de Docker Desktop porque el usuario lo prohibió sin autorización específica. La política runtime y el Compose persistente están verificados, pero el comportamiento después de un reinicio real del motor aún no se ensayó.

## Recuperación futura

1. Si Docker Desktop reinicia, esperar a que el motor esté disponible y comprobar `docker inspect` de ambos contenedores: `RestartPolicy.Name=unless-stopped`, mismos IDs de imagen y montajes. Si el servicio fue detenido **deliberadamente**, `unless-stopped` no lo inicia automáticamente; usar el orden documentado en [el acta de recuperación](billing-operational-recovery-20261110.md): PostgreSQL, esperar `healthy`, luego API, esperar `healthy`.
2. Si falta el volumen de llave, **no** crear ni rotar credenciales ni arrancar emisión. Con autorización de restauración, detener la API, verificar SHA-256 del DPAPI y manifiesto, descifrar bajo la misma cuenta Windows **solo en memoria**, restaurar a un volumen nuevo con permisos `0400` mediante stdin, comparar la huella del manifiesto y revisar el montaje antes de iniciar la API. Nunca restaurar sobre un volumen que aún contiene una llave.
3. Si el modo documental se sustituye en el futuro por un ensayo de envío fiscal o correo, revisar y retirar explícitamente la política de la API antes de cambiar las banderas. El Compose base de API conserva su comportamiento anterior; la excepción `unless-stopped` está confinada a la capa de lectura documental.

No se hizo merge, push ni despliegue remoto.
