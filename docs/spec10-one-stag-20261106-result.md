# SPEC-10 — Primera factura de Afiliaciones aceptada en Hacienda STAG

Fecha local: 2026-11-06. Alcance: SANDBOX local; un pago nuevo, una factura, un POST y un GET. No se contactó producción ni se utilizó SMTP.

## Resultado fiscal

| Control | Resultado |
| --- | --- |
| Afiliaciones → Billing | Pago `494c6cad-641d-43ae-9f9a-debc57867339` APPROVED; outbox COMMITTED con el documento indicado abajo |
| Factura Billing | `817f1bd8-0092-4661-9064-e7f69d18b5b6` |
| Clave | `50606112600020753025100100001010000000008156925025` |
| Consecutivo | `00100001010000000008`; secuencia SANDBOX/001/00001/INVOICE pasó de `7/8` a `8/9` |
| XML firmado | XSD VALID, firma verificada; SHA-256 `e5eaac5796ed75ecc6c018d5462e11048903c32ea8a4c5f14e2f24562205da4f` |
| POST STAG | HTTP 202; `attempt_count=1`. Se trató como resultado no concluyente hasta consultar estado. |
| GET STAG | HTTP 200; `reconciliation_attempt_count=1`; `ind-estado=aceptado` |
| Persistencia | Documento y submission ACCEPTED; respuesta oficial SHA-256 `dc26b7e28ec3d75d95bd105cce2a48f99c1943d5a236e91f315a27ea8015936f` |
| Duplicados | Una sola factura para el pago; total de facturas SPEC-09: dos, incluida la anterior en revisión manual |

La factura anterior `140adc48-7e4e-42bb-85bb-effe017483e2` permaneció en `MANUAL_REVIEW_REQUIRED`, con un intento POST y HTTP 403; no se reenvió.

## Paquete y entrega

Billing conservó XML firmado y respuesta oficial. El servicio PDF instalado generó un PDF de 4269 bytes, SHA-256 `729bad376e88897a3364e38a829374686290a6d5d0cb8b3e78a1f67cdfe28317`. `AcceptedFiscalPackageResendService.preflightForAuthorizedRequest` verificó los tres artefactos y su receptor. `MockEmailDeliveryAdapter` simuló una entrega con los tres archivos, sin red ni SMTP; marcador `SPEC10_ACCEPTED_PACKAGE_SIMULATED_PASS`.

La respuesta fiscal tiene además una fila `HACIENDA_RESPONSE|DELIVERED|1` en el registro de entregas de Billing, mediante el adaptador simulado. **La entrega conjunta automática v2 no se ejecutó:** la clave M2M instalada carece de `fiscal-v2:deliveries:request`. No se amplió el scope, no se rotó ninguna credencial y no se creó una fila de entrega conjunta. No interpretar la simulación como correo real recibido.

## Controles al cierre

- Billing y Afiliaciones API: `healthy`. Billing image `sha256:2ab4e66a67c74818d12d35f502f1e000666ac8c7f8fec3b1a1b6ba26caf5489e`; Afiliaciones API image `sha256:6c81eacecdd4d56130818c7779482e27ce62bbd56281368868a89d7862a0f3a2`.
- `USE_REAL_HACIENDA=false`, `BILLING_SPEC09_STAG_INVOICING=false`, `BILLING_MEMBERSHIP_STAG_ENABLED=false`, `EMAIL_USE_REAL=false` después de recibir la aceptación.
- Billing histórico API y worker permanecieron detenidos durante la prueba y al cierre para evitar emisiones concurrentes con el mismo emisor y punto fiscal. Su PostgreSQL no se modificó.
- Respaldo frío previo y restauración comprobada: `D:\SPEC10-STAG-Prep-20261106-190121` (manifest y cuatro volúmenes). No usarlo para revertir sin preservar primero esta factura aceptada.
- No se modificaron certificados, PIN, credenciales, identidad fiscal ni documentos previos. La única actualización del contador fue auditada y específica a SANDBOX/001/00001/INVOICE.

## Reproducción segura de evidencia local

1. Consultar las filas del documento y submission en `fiscal_documents` y `fiscal_submissions` de `spec09-billing-postgres-1`; verificar `ACCEPTED`, `attempt_count=1`, `reconciliation_attempt_count=1`, `last_http_status=200` y `last_provider_status=aceptado`.
2. Consultar `fiscal_artifacts` para los tres tipos `SIGNED_XML`, `PDF` y `HACIENDA_RESPONSE_XML`, comparando sus SHA-256 con esta tabla; no extraer los bytes a un reporte.
3. Consultar `FiscalOutbox` de `aflilientions-postgres-1` por el pago; verificar `COMMITTED` y la misma factura.
4. Ejecutar solo si se desea repetir la comprobación local sin contactar Hacienda: `Get-Content -Raw scripts\spec10\verify-accepted-package-simulated.cjs | docker exec -i spec09-billing-billing-spec09-sandbox-1 node -`. La ejecución repetida simula otra entrega en memoria; no crea una nueva factura ni usa SMTP.

Pendiente: provisionar mediante el procedimiento administrativo probado un scope de entrega mínimo, conservando el solapamiento de claves, para probar la ruta M2M v2 de entrega conjunta. Requiere una operación separada de administración de credenciales; no es condición para la aceptación fiscal ya obtenida.
