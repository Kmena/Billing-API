# Billing SPEC-09 — Primer envío de membresía a STAG

**Estado: PARTIAL / HACIENDA_STAG_403.** El 5 de noviembre de 2026 Billing creó un único documento SANDBOX `140adc48-7e4e-42bb-85bb-effe017483e2` para un pago sintético aprobado por Afiliaciones. El XML firmó correctamente, pasó XSD v4.4 y verificó la firma. El primer POST a recepción STAG recibió HTTP 403. La solicitud quedó en `MANUAL_REVIEW_REQUIRED`, sin respuesta de validación ni entrega de correo. No se hizo un segundo POST.

## Corrección local

El contrato v2 admitía el código de SINPE Móvil `06`, pero `ALLOWED_PAYMENT_METHODS` en el servicio fiscal v1 no lo incluía. El commit `809f506eada15a14aa19b4323b1e916adde8a729` añadió `06` y una prueba que atraviesa la validación del documento. Pasaron 22 pruebas focales, incluida proyección, firma y XSD sintéticos; typecheck y ESLint de archivos cambiados pasaron. La imagen instalada es `sha256:9a9e4cc897f3d81db19bf13e6be8dbff52aa98a698ad6c87fa35e961fae69efb`.

La lista oficial de medios de pago v4.4 de Hacienda asigna `06` a SINPE Móvil: [anexo y estructuras](https://www.hacienda.go.cr/docs/ANEXOS_Y_ESTRUCTURAS_V4.4.pdf).

## Estado y conservación

- `fiscal_documents=1`, `fiscal_submissions=1`, `document_deliveries=0`.
- Autenticación Hacienda: conexión SANDBOX `CONNECTED`, autenticación previa registrada. La autorización para recepción no está demostrada; el HTTP 403 es el bloqueo.
- El almacén cifrado y la configuración fiscal conservaron sus huellas. Seis de 23 tablas cambiaron por la factura, su secuencia, idempotencia, XML y solicitud. Las otras 17 permanecieron en `MATCH`.
- Respaldos PostgreSQL y de volúmenes cifrados anteriores al documento se restauraron en tmpfs. Están fuera de Git en `D:\SPEC09-STAG-20261105-1520\post-approval-recovery-backup`. No restaurar sobre el intento actual sin reconciliación.
- Después de la prueba, el bootstrap del SANDBOX permite apagar STAG cuando todos los documentos tienen solicitudes terminales y no hay entregas pendientes. La API arrancó sana con `BILLING_SPEC09_STAG_INVOICING=false`, `USE_REAL_HACIENDA=false`, `FISCAL_WORKER_ENABLE_IN_TESTS=false` y `EMAIL_USE_REAL=false`. La clave SMTP sigue cifrada y no se usó para enviar.

## Criterio para reabrir

Investigar con Hacienda la autorización del emisor y de las credenciales para el recurso de recepción STAG; una autenticación correcta no basta. Reconciliar la clave del documento ya creado antes de cualquier nuevo envío. No emitir otra factura ni reenviar automáticamente este documento. Producción sigue bloqueada.
