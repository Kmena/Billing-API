# SPEC-10 — Evidencia del contrato M2M v2 de documentos

Fecha: 2026-11-06. Rama aislada: `codex/spec10-m2m-documents`, basada en `codex/spec10-one-stag-preparation`. Sin DDL, cambios de credenciales, certificados, secuencias ni artefactos persistentes.

## Decisiones de seguridad y datos

El guard M2M v2 mantiene `fiscal-v2:operations:read`. La clave de Afiliaciones ya posee este scope para GET de documento y XML firmado; la extensión no requiere un scope nuevo ni altera la clave instalada. `W2B2LabInvoiceService.getDocument` valida vigencia de la clave, tenant, empresa, ambiente, asociación y origen del comprobante antes de consultar metadatos o bytes. El contrato devuelve huellas, tamaños y disponibilidad; nunca devuelve storage keys ni receptor de correo.

El PDF se lee con `FiscalPdfArtifactStateService`, que comprueba hash, tamaño, estructura e identidad. El XML firmado y la respuesta se leen con `FiscalEvidenceResolverService`, que comprueba SHA-256. El ZIP se crea temporalmente con método STORE a partir de esos mismos bytes y no añade filas, regeneraciones ni envíos. Las descargas exponen `X-Content-SHA256`.

El estado del correo es independiente del estado fiscal; se prioriza la entrega `ACCEPTED_FISCAL_PACKAGE` si existe. `DELIVERED` conserva el significado operativo de aceptación por el transporte, sin afirmar lectura del destinatario.

## Pruebas ejecutadas

- `npm run typecheck`: PASS.
- ESLint de los ocho archivos fuente y pruebas modificados: PASS.
- `spec10-invoice-documents.service.spec.ts` y `spec10-zip.spec.ts`: 7/7 PASS. Incluye aceptada, pendiente, rechazada, revisión manual, ausencia de artefactos, selección del correo, autorización previa al acceso y conservación de bytes en ZIP.
- `w2-b2-persistent-invoice.e2e-spec.ts`, caso `requests one complete accepted package`: PASS en PostgreSQL descartable `billing_p0_p0b20bbebcd9be_test`. El test creó una factura sintética, simuló la aceptación del proveedor, consultó `/fiscal-view`, descargó los tres artefactos y ZIP, comprobó sus SHA-256 y confirmó que los GET no aumentaron el número de facturas ni entregas.
- El mismo archivo, caso `enforces scope, origin isolation`: PASS en PostgreSQL descartable `billing_p0_p0884e18138e6c_test`. Cubre asociación ajena (404), scope de solo creación (403), revocación (401) y separación de la API v1.

Las bases se crearon mediante `scripts/test-safety/disposable-postgres.mjs` con contenedores aleatorios etiquetados y volumen `tmpfs`; el runner terminó con código 0 y no usó el Docker persistente.

## Límite de esta evidencia

El módulo M2M v2 de laboratorio continúa registrado solo por `W2B2FiscalLabModule` bajo `NODE_ENV=test`; no se registró en `AppModule` de producción. No se hizo GET en vivo de la factura STAG `817f1bd8-0092-4661-9064-e7f69d18b5b6`. Esa verificación queda preparada en Afiliaciones y exige autorización de instalación o acceso al Docker persistente.
