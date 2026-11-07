# SPEC-10 — Instalación local controlada

Fecha local: 2026-11-07. Sin merge a `main`, tags estables, migraciones, cambios en Inventori, rotación de credenciales, emisión, solicitudes a Hacienda ni envío de correo.

## Origen e instalación

- Billing instalado previamente: `billing-spec10:single-stag-c3890d7` (`sha256:2ab4e66a67c74818d12d35f502f1e000666ac8c7f8fec3b1a1b6ba26caf5489e`). Integración selectiva: rama `codex/spec10-local-install-billing`, commit `45b3c07daef701a14efac264dc1daff2692a6ac6`, imagen `billing-spec10:documents-install-20261106` (`sha256:eba8ab4c0e927f840b085bd92da4609bf7f0af34d672193f73af0d82fda3a1fb`). El SHA-256 de los binarios `hacienda-recepcion.adapter.js` y `hacienda-oidc-auth.adapter.js` coincide entre las imágenes anterior y nueva.
- Afiliaciones instalada previamente: API `afiliaciones-spec09-api:destination-28404a4`, Web `afiliaciones-spec09-web:destination-28404a4`. Integración selectiva: rama `codex/spec10-local-install-afiliaciones`, commit `d3cb23641b5beff18bc0b4e0883237de8c47c4fe`. Se omitieron los commits intermedios que cambiaban la emisión y pedían paquetes por correo. Imágenes nuevas: API `sha256:0bedbca66d05d781fc3abaa7726b91cce4eccb4a6cde219f9e8ac4cfa1f81d22`, Web `sha256:cbe620950c5cc5446d4e8bb48ae08ce9536860f96424a746d8cdcbfcacb2c0d1`.
- Compose recreó únicamente Billing, API y Web con `--no-deps --no-build`. Los contenedores Billing y API reportaron `healthy`; Web sirvió HTTP 200 y su bundle contiene el panel y la columna «Estado fiscal». Las migraciones permanecieron en 32 (Billing) y 28 (Afiliaciones).
- Flags efectivos: `USE_REAL_HACIENDA=false`, `FISCAL_WORKER_ENABLE_IN_TESTS=false`, `EMAIL_USE_REAL=false`, `BILLING_ENABLED=false`, `BILLING_MEMBERSHIP_STAG_ENABLED=false`, `SPEC10_DOCUMENTS_READ=true`, `BILLING_DOCUMENTS_READ_ENABLED=true`.

## Respaldos y rollback

Directorio privado: `D:\SPEC10-Install-20261106-2247`. Ambas bases tienen dump lógico restaurado en PostgreSQL desechable con tmpfs. El dump Afiliaciones se repitió tras conceder `billing.operations.view` al aprobador; el anterior se conservó en `pre-grant`. Los volúmenes `spec09_billing_fiscal_storage`, `spec09_billing_secret_store` y `spec09_billing_master_key` se respaldaron con digest anterior/posterior coincidente y restauración verificada en tmpfs. `inventory.json` registra imágenes y montajes anteriores. Los overlays de rollback validaron mediante `validate-rollback` sin aplicarse.

Para revertir, ejecutar `scripts/spec10/operate-documents-install.ps1 -Service affiliations -Action rollback` y después el mismo comando con `-Service billing`. El script verifica respaldos y Compose antes de recrear servicios. No borra volúmenes.

## Pruebas previas

- Billing: build, typecheck y lint completo PASS; 7 unitarias de documentos/ZIP PASS; 5 E2E seleccionadas en PostgreSQL descartable PASS. Cubren factura, alcance M2M, aislamiento de origen, PDF/XML/respuesta/ZIP, NC y ND.
- Afiliaciones: build, typecheck y lint PASS; 5 pruebas API de estado/descarga PASS; 14 Web del panel/Pagos PASS; 10 de contrato de onboarding y modo documental PASS.
- Las composiciones de instalación y rollback validaron con envío fiscal y correo apagados. No hubo cambios de Prisma entre las versiones instaladas y las ramas de integración.

## Factura STAG de referencia

Factura `817f1bd8-0092-4661-9064-e7f69d18b5b6`; pago `494c6cad-641d-43ae-9f9a-debc57867339`; consecutivo `00100001010000000008`. La clave M2M instalada tiene `fiscal-v2:operations:read`. La clave de envoltura DPAPI existente se inyectó solo en `/run/spec09-m2m-wrap` (tmpfs) usando `scripts/spec09-sandbox/inject-m2m-wrapping-key.ps1`; no se creó ni rotó ninguna clave. Tras recrear la API es necesario repetir esa inyección, también después de cualquier reinicio del contenedor.

Cinco GET M2M desde Afiliaciones devolvieron `ACCEPTED`, aceptación `2026-11-06T20:55:29.061Z`, correo `DELIVERED` y los bytes originales. La ruta documental de Afiliaciones se probó con el actor y los permisos leídos de la base instalada: estado real y cuatro descargas PASS; sin `billing.operations.view` respondió 403 y con empresa ajena 404. El ZIP contiene exactamente los tres originales. SHA-256:

| Artefacto | SHA-256 |
| --- | --- |
| PDF | `729bad376e88897a3364e38a829374686290a6d5d0cb8b3e78a1f67cdfe28317` |
| XML firmado | `e5eaac5796ed75ecc6c018d5462e11048903c32ea8a4c5f14e2f24562205da4f` |
| Respuesta Hacienda | `dc26b7e28ec3d75d95bd105cce2a48f99c1943d5a236e91f315a27ea8015936f` |
| ZIP temporal | `8f8ee871a1ff064e89b2d4fdf2f1abcf2fe15de153fff85a1e26176924d54866` |

Antes y después: Billing `2` documentos, `2` submissions, suma de intentos `2`, `2` entregas y `2` intentos de entrega; Afiliaciones `2` outbox y `2` referencias. Las cuatro descargas añadieron exactamente cuatro eventos de auditoría. El GET público sin sesión devolvió 401.

## Verificación pendiente

Falta observar el panel y las descargas en una pestaña autenticada del usuario autorizado. El control de navegador disponible no pudo determinar con seguridad la URL de Brave, y la consulta de solo conteo confirmó que el aprobador aún no tenía una sesión vigente. La ruta API real con actor de base, la Web servida y las pruebas Web pasaron; **`FISCAL_STATUS_VISIBLE` en una sesión real y `SPEC10_AFFILIATIONS_FISCAL_UX_READY` permanecen pendientes** hasta esa comprobación. No afirmar PASS global con esta evidencia parcial.
