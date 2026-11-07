# SPEC-10: promoción estable y entrega de la factura STAG

Fecha: 2026-11-06. Alcance: Billing SANDBOX local. No hubo nueva factura ni contacto con Hacienda durante esta operación.

## Entrega real

La factura `817f1bd8-0092-4661-9064-e7f69d18b5b6` conservó la clave `50606112600020753025100100001010000000008156925025`, el consecutivo `00100001010000000008`, el estado `ACCEPTED`, un POST y un GET. Antes del envío, Billing verificó receptor, estado, unicidad de la entrega y las huellas de los tres artefactos. No había trabajos pendientes en `pgboss.job`.

| Archivo | SHA-256 | Resultado de descarga |
| --- | --- | --- |
| `50606112600020753025100100001010000000008156925025.pdf` | `729bad376e88897a3364e38a829374686290a6d5d0cb8b3e78a1f67cdfe28317` | MATCH, 4269 bytes |
| `50606112600020753025100100001010000000008156925025.xml` | `e5eaac5796ed75ecc6c018d5462e11048903c32ea8a4c5f14e2f24562205da4f` | MATCH, 7601 bytes |
| `50606112600020753025100100001010000000008156925025_respuesta.xml` | `dc26b7e28ec3d75d95bd105cce2a48f99c1943d5a236e91f315a27ea8015936f` | MATCH, 5596 bytes |

Destinatario confirmado: `kmena281@gmail.com`. Se llamó una vez a la ruta existente `accepted-package-resend` con una clave TEST de diez minutos, limitada a `fiscal-deliveries:resend` y a la empresa del documento. La ruta devolvió `202`; el trabajador registró `DELIVERED` en la entrega `eb21cfe7-727d-4e8f-abbe-9b96783ac361`, con un intento y el ID SMTP `<aadfdde2-e9fa-7009-74bd-0fa04079df85@gmail.com>`. La clave temporal quedó `REVOKED`; constan auditorías de emisión y revocación. El operador confirmó la llegada a su correo y los tres archivos descargados coinciden con las huellas de Billing. No se imprimieron claves ni credenciales.

La aceptación del servidor SMTP y la confirmación del operador son evidencias distintas. No se inspeccionaron encabezados internos del buzón ni se activó correo automático general.

## Ventana y recuperación

La imagen fiscal que obtuvo la aceptación STAG fue `sha256:2ab4e66a67c74818d12d35f502f1e000666ac8c7f8fec3b1a1b6ba26caf5489e`, revisión OCI `c3890d7252d8e778a706c30a81ed58401d46ca6c`. Un parche aislado de la política de SANDBOX permitió ejecutar únicamente el trabajador de correo con Hacienda apagada; imagen local temporal `sha256:07475a0ebd8c475b6d378d936072000639b2d388bf87fccb6d66229e698c7c51`, derivada de la imagen anterior con un solo archivo compilado cambiado (SHA-256 `51ceea29aaff298feb0d206a7009f2d87729bb910cbd94a6900f8b613809d0c2`). El código fuente está en `src/infrastructure/storage/spec09-stag-safety.ts`.

El bootstrap limitado `scripts/spec10/billing-bootstrap.single-email.cjs` permite la ruta de reenvío de esta factura solamente durante `SPEC10_SINGLE_EMAIL=true`; exige el permiso de la API. Sin clave respondió `401`; la ruta de otra factura respondió `404`. Se deshabilitaron temporalmente consulta tributaria y verificación de credenciales. Las tres instalaciones de volumen fiscal, almacén cifrado y clave maestra conservaron sus montajes. No se aplicaron migraciones.

Tras confirmar la entrega, se aplicó `scripts/spec10/compose.billing.post-email.yaml`. Billing arrancó `healthy` con la **imagen fiscal original**, `EMAIL_USE_REAL=false`, `USE_REAL_HACIENDA=false`, trabajador fiscal apagado y los modos previos de consulta tributaria/credenciales restaurados. La entrega y revocación persistieron tras el reinicio. El bootstrap limitado permanece montado porque el bootstrap anterior rechazaba cualquier clave histórica fuera del perfil de Afiliaciones, incluso revocada. No eliminar la clave temporal ni su auditoría para volver al bootstrap anterior. En caso de fallo, detener el servicio, revisar el estado único de la entrega y usar el overlay posterior al correo; nunca repetir el POST de entrega a ciegas ni restaurar una base anterior a la factura aceptada.

## Promoción a `main`

La base del parche es `0e1f6ef890acba2d17d996ece4dd295a1a6f4dc7`; el SHA final de esta evidencia se registra al cerrar el commit. `main` estaba en `b6c454f7d559c8f05eca173482f0ba56d7ba702a`, ancestro de la rama; el tag `billing-v1.0.0-stable` no existía. La comparación desde la revisión de la imagen aceptada hasta esa base mostró cambios de documentación, scripts y pruebas; el parche de correo modifica solo la guardia SANDBOX y no el adaptador fiscal.

Pruebas: unitarias 126 suites y 1401 tests aprobados antes del parche de correo; contrato E2E de facturación v2 y onboarding Inventori 22/22 en combinación; seguridad del modo correo 3/3; typecheck, build y lint aprobados. El onboarding Wave 1 pasó completo aislado (19/19). Se corrigió una espera asíncrona en Wave 8 y se aisló `FISCAL_WORKER_ENABLE_IN_TESTS` entre suites. La última corrida integral con la base W5 configurada correctamente aprobó **32/34 suites y 234/236 pruebas**. Fallaron la concurrencia de `ACCEPTED_FISCAL_PACKAGE` en `w2-b2-persistent-invoice.e2e-spec.ts` y `spec09-encrypted-recovery.e2e-spec.ts`; antes habían pasado aisladas. Este resultado impide concluir que la regresión conjunta está limpia. `BILLING_MAIN_MERGE=BLOCKED` y `BILLING_STABLE_TAG=NOT_CREATED` hasta diagnosticar y corregir ambos casos y obtener una corrida integral sin fallos. No se hizo push ni despliegue productivo.
