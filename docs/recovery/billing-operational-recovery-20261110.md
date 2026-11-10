# Recuperación local de Billing y SANDBOX histórico

Fecha local: 2026-11-10. **Resultado: `BILLING_OPERATIONAL_RECOVERY_PASS`** para los servicios y consultas verificados. No se modificó Afiliaciones, Inventori, el guardián M2M ni Billing v1. No se ejecutaron migraciones, no se recrearon contenedores y no se reconstruyeron imágenes.

## Causa

El 2026-11-09 Docker Desktop registró el motor como `starting` a las 14:07:32 UTC y `running` a las 14:08:35 UTC. `spec09-billing-postgres-1` y `spec09-billing-billing-spec09-sandbox-1` salieron con código `255` a las 14:08:07 UTC, con `State.Error` vacío y política de reinicio `no`. En el mismo arranque, el PostgreSQL de Billing v1 con política `unless-stopped` volvió a iniciar. **Causa operativa de la indisponibilidad:** interrupción del motor Docker seguida de la ausencia de reinicio automático de esos dos contenedores históricos. No quedó acreditado qué disparó el reinicio de Docker Desktop; no se atribuye a la aplicación ni a una migración.

## Inventario y preflight

| Instalación | Imagen y estado final | Persistencia / red |
| --- | --- | --- |
| Billing v1 API y worker | Ambos `sha256:a4a02cbc69eb192187145286cdb008827b0006f7e77b66f2ae258087414f187e`, revisión OCI `3b0893fb02bbe0fb6e51ebcda795a7d1555f3820`, `healthy`. No se iniciaron ni sustituyeron. | PostgreSQL `billing-postgres` en `billing_postgres_data`, red `billing_default`; almacenamiento cifrado independiente. |
| Billing v2 SANDBOX histórico API | Contenedor original `spec09-billing-billing-spec09-sandbox-1`, imagen `sha256:eba8ab4c0e927f840b085bd92da4609bf7f0af34d672193f73af0d82fda3a1fb`, revisión OCI `45b3c07daef701a14efac264dc1daff2692a6ac6`, `healthy`. | Redes `spec09_billing_backend` y `aflilientions_internal`, alias `billing-spec09-sandbox`, TLS interno `3443`; sin puerto host publicado. |
| SANDBOX PostgreSQL | Contenedor original `spec09-billing-postgres-1`, imagen `sha256:fff3594bf464bea0f502788874403882d8bbbe618b3250f8649e7e42fd118020`, `healthy`. | Volumen exclusivo `spec09_billing_pgdata`, red `spec09_billing_backend`, alias `billing-spec09-db`, puerto host `127.0.0.1:55439` sin conflicto. |

Los volúmenes `spec09_billing_pgdata`, `spec09_billing_secret_store`, `spec09_billing_fiscal_storage` y `spec09_billing_master_key` existen. Una inspección con contenedores efímeros, sin red y montajes de **solo lectura** confirmó `PG_VERSION=16`, `global/pg_control`, la llave maestra presente, 11 archivos en el almacén cifrado y 7 en almacenamiento fiscal. El certificado y la llave TLS montados existen; no se leyó ni mostró su contenido. El script de arranque montado es `scripts/spec10/billing-bootstrap.documents.cjs`: consulta y valida la base antes de abrir la API, no llama Prisma Migrate. El PostgreSQL reutilizó su volumen no vacío.

Antes del arranque se verificó `USE_REAL_HACIENDA=false`, `EMAIL_USE_REAL=false`, `FISCAL_WORKER_ENABLE_IN_TESTS=false`, `BILLING_SPEC09_STAG_INVOICING=false`, `SPEC10_SINGLE_EMAIL=false` y `SPEC10_DOCUMENTS_READ=true`. La imagen v1 establece por defecto `false` para `EMAIL_USE_REAL` y `USE_REAL_HACIENDA`; la API v1 tiene explícitamente `USE_REAL_HACIENDA=false`. No se cambió ninguna credencial ni configuración Compose, red o montaje; PostgreSQL realizó su arranque normal sobre el volumen existente. Las capas Compose históricas siguen siendo referencia del contenedor; para recuperar se usó **`docker start`**, no `docker compose up`.

## Respaldos e integridad

- Respaldo lógico SANDBOX previo `D:\SPEC09-Install-20261104-1555\billing\billing-2026-11-04T15-56-22-415Z.dump`: SHA-256 `8e70d0dd9a2b7862f440ea6fdafab3e78598d0584528c1626af04480819ab64a`; `pg_restore -l` válido.
- Respaldo previo de volúmenes cifrados: `encrypted-volumes/manifest.json`, con hashes coincidentes para `spec09_billing_secret_store.tar` (`ada9c239ad2c80f1898ca4de5fb40e0ec98e951382b707da76d1f288ec5bc09d`) y `spec09_billing_fiscal_storage.tar` (`625de7005e9a7ceddfc99fe84b1758fda77cc171c408a41866bd1d569e701cb2`). No se encontró copia externa independiente del volumen de llave maestra; es un riesgo de recuperación futura, no una falla del volumen actual.
- **Antes de iniciar PostgreSQL**, copia fría de `spec09_billing_pgdata` en `D:\SPEC09-Install-20261104-1555\recovery-20261110\spec09-billing-pgdata-cold.tar`, 69 506 048 bytes, SHA-256 `36bba127f28c8f1102c968b6f79132f319b9eb567d64164a04454ae7c4e28b38`; listado TAR comprobado. Se leyó el volumen solo en modo lectura.
- **Después de recuperar PostgreSQL y antes de la API**, respaldo lógico actual en `D:\SPEC09-Install-20261104-1555\recovery-20261110\spec09-billing-current.dump`, 208 102 bytes, SHA-256 `efaef07a1f924e48ca927fc27d692dbac142f77aaa9932f4c4d69eea21a3009b`; `pg_restore -l` válido. Ambos respaldos nuevos están en un directorio privado cuya ACL concede acceso solo a `SYSTEM` y a la cuenta autorizada.

## Arranque y validación

1. `docker start spec09-billing-postgres-1`: aceptó conexiones y pasó su healthcheck. Ledger de SANDBOX: **32 migraciones terminadas** antes y después; no se ejecutó ninguna.
2. `docker start spec09-billing-billing-spec09-sandbox-1`: el mismo ID de contenedor e imagen llegó a `healthy`; su `/health/ready` respondió HTTP `200` desde Afiliaciones. El arranque protegido pasó sin modificar datos de negocio.
3. Desde el contenedor de Afiliaciones, usando **en memoria** la credencial M2M histórica cifrada, Billing devolvió configuración SANDBOX y `status=READY`. Una clave sintética inválida recibió `401`. No se imprimió ni rotó la credencial.
4. Consulta fiscal de dos documentos existentes: `140adc48-7e4e-42bb-85bb-effe017483e2` (`READY_TO_SUBMIT`) y `817f1bd8-0092-4661-9064-e7f69d18b5b6` (`ACCEPTED`). La descarga M2M de ambos XML firmados devolvió 7 601 bytes cada uno; SHA-256 `227e1ccb0f2f8abc952d46c5876e68f33c8d3aa0bb627fee35baee7dc01f5036` y `e5eaac5796ed75ecc6c018d5462e11048903c32ea8a4c5f14e2f24562205da4f`, respectivamente, iguales a la base y a los encabezados de integridad. Ambos registros XML tienen XSD `VALID`. Solo el segundo está marcado `ACCEPTED`; no se infiere aceptación del primero.
5. Conteos SANDBOX antes/después de las consultas: **2** documentos, **2** envíos, **2** entregas, **4** artefactos, **46** auditorías y **32** migraciones, sin variación. No hubo nuevos envíos ni entregas persistidos. La configuración de emisión y correo real permaneció desactivada.
6. Billing v1 conservó API, worker y PostgreSQL `healthy`, misma imagen y mismos contenedores; su API respondió HTTP `200` en `/health/ready`. Su base registra **3** documentos, **3** envíos, **6** entregas y **25** migraciones. Inventori no se modificó. La autenticación M2M y los XML de SANDBOX sí se verificaron funcionalmente; el E2E de Inventori no se ensayó en esta recuperación.

## Arranque futuro y límites

Con el motor Docker disponible, comprobar primero IDs de imagen, volúmenes, banderas `false`, archivo TLS y que `55439` esté libre. Luego iniciar **en orden** `docker start spec09-billing-postgres-1`, esperar `healthy`, y `docker start spec09-billing-billing-spec09-sandbox-1`, esperar `healthy`. Verificar desde Afiliaciones una configuración M2M y un documento existente con un GET; comparar conteos y hashes. Si el guardia de arranque rechaza la base, **no** ejecutar migraciones, `migrate resolve`, recreación, reparación del ledger ni cambio de claves: detenerse y evaluar la copia fría y el dump con un DBA. No usar `docker compose up` para este procedimiento porque puede recrear servicios.

Ambos contenedores SANDBOX siguen con `restart=no`; un futuro reinicio de Docker Desktop puede volver a dejarlos detenidos. Cambiar esa política o automatizar su arranque requiere una decisión separada. La recuperación de esta fase se limita a la instancia local existente, sin envíos fiscales o correo real.
