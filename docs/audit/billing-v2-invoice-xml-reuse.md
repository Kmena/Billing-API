# Recuperación de XML firmado para consumidor v2 (laboratorio)

**Base:** Billing `4f60773`, rama aislada `codex/billing-v2-invoice-xml-m2m`; Inventori se inspeccionó en modo lectura desde `6fc23d1` (los tres archivos citados estaban limpios). Este cambio solo registra la ruta mediante `W2B2FiscalLabModule` en `NODE_ENV=test`; `AppModule` no la importa. No habilita STAG, producción ni Hacienda.

## Auditoría del flujo v1 usado por Inventori

| Pregunta | Hallazgo y referencia |
| --- | --- |
| Endpoint de Inventori y Billing | Inventori ofrece `GET /api/invoices/:id/fiscal-artifacts/:artifactType` con `signed-xml`, `pdf` y `hacienda-response` en `src/routes/invoice.routes.js`. Su cliente llama `GET /api/v1/companies/{companyId}/fiscal-documents/{environment}/invoices/{documentId}/artifacts`, busca el tipo y descarga `GET .../artifacts/{artifactId}/download` (`src/services/billing-api-client.service.js`). Billing implementa esas rutas en `src/modules/fiscal-documents/infrastructure/http/fiscal-artifacts.controller.ts`. |
| Autenticación y autorización | Inventori autentica sesión, permiso `invoice.fiscal-artifact` y empresa; `resolveArtifactOwnershipChain` exige factura, intención y configuración de la empresa autenticada (`src/services/fiscal-artifact-proxy.service.js`). Billing v1 exige `X-API-Key`, `ApiKeyAuthGuard`, `ScopeGuard`, `invoices:read`, vínculo clave/empresa y tenant (`FiscalArtifactsController`, `FiscalArtifactService.assertCompanyAccess`). |
| Servicio de recuperación | `FiscalArtifactService.listArtifacts/downloadArtifact` devuelve el índice `FiscalArtifact`; para XML verifica SHA-256 mediante `FiscalEvidenceResolverService.verifyIntegrity` y descarga por `StoragePort`. `FiscalArtifactIndexService` indexa XML firmado o respuesta de Hacienda apuntando a los bytes existentes. |
| Almacenamiento y vínculo | `FiscalXmlArtifact` guarda `fiscalDocumentId`, `signedXmlStorageKey` y `signedXmlSha256` (`prisma/schema.prisma`). `StoragePort` resuelve la clave hacia almacenamiento local o S3; `FiscalArtifact` es índice de metadatos, no otra copia. La respuesta de Hacienda usa `FiscalSubmission.responseStorageKey/responseSha256`; el PDF usa `FiscalArtifact` y su verificador de estado. |
| Integridad | `FiscalEvidenceResolverService.resolveSignedXmlBytes` descarga el blob original y compara su SHA-256 persistido antes de devolverlo. El endpoint v1 de artefactos también verifica hash y tamaño. Un hash distinto bloquea la entrega con `ARTIFACT_INTEGRITY_FAILURE` (422). |
| Estado y ausencia | El endpoint v1 de artefactos autoriza por propiedad, tipo y presencia del artefacto, sin exigir `ACCEPTED`. El XML firmado local puede existir en `READY_TO_SUBMIT`; eso no acredita recepción de Hacienda. Si aún no hay XML, devuelve 404. PDF y respuesta de Hacienda aparecen solo cuando sus artefactos respectivos existen; no se generan durante una descarga. |
| Compatibilidad v1 | El cliente de Inventori y los controladores/servicios v1 de Billing no cambian. El inventario de 42 pares verbo/ruta está en `docs/contracts/inventori-v1-inventory-w0.md`; la regresión de contrato fija las rutas críticas. |

## Adaptador v2 mínimo

`GET /api/v2/lab/companies/{companyId}/fiscal-documents/SANDBOX/invoices/{documentId}/signed-xml` usa `ConsumerV2Guard` con `fiscal-v2:operations:read`. `W2B2LabInvoiceService.getDocument` comprueba tenant, empresa, ambiente, tipo `INVOICE`, `originConsumerId` y `originAssociationId` antes de llamar al **servicio documental existente** `FiscalEvidenceResolverService.resolveSignedXmlBytes`. La respuesta es `application/xml`, `Cache-Control: no-store` y `X-Content-SHA256`, con los bytes almacenados sin recálculo ni nueva firma. No se cambió ningún contrato v1 ni esquema de base de datos.

El contrato ejecutable está en `docs/contracts/billing-w2-b2-lab.v2.openapi.yaml`. Errores: 400 UUID inválido, 401 clave ausente/revocada, 403 scope/asociación/ambiente, 404 factura fuera del origen autenticado o XML aún ausente, 422 integridad fallida. Las rutas v2 siguen **solo en laboratorio**; el contrato productivo continúa pendiente de aprobación.

## Compatibilidad con Afiliaciones W5

Afiliaciones `08afb95` conserva `ExternalFiscalReference.billingDocumentId` y no almacena XML. Su E2E existente crea pago aprobado, intención, factura local y referencia mediante HTTP real. La prueba cruzada de esta rama usa ese mismo flujo y luego descarga el XML por la nueva ruta M2M; compara bytes y hash con el artefacto almacenado en Billing. No se modificó el repositorio de Afiliaciones.

Cambio mínimo posterior en Afiliaciones: añadir a `BillingLabHttpClient` un método `invoiceSignedXml(companyId, secret, documentId)` análogo a `correctiveSignedXml`, con límite de bytes y verificación de `X-Content-SHA256`; invocarlo después de confirmar `READY_TO_SUBMIT` si el flujo requiere visualizar/descargar la factura. Mantener solo la referencia al documento administrado por Billing. No usar esa ruta fuera del laboratorio hasta habilitación formal.

## Verificación

Las pruebas nuevas cubren autorización antes de leer bytes, identidad de bytes, SHA-256, XML pendiente, recuperación, nueva instancia de API, empresa/consumidor ajenos, scope insuficiente, clave revocada y ambiente incorrecto. El E2E cruzado emplea PostgreSQL separados y descartables, certificado y M2M sintéticos. La prueba de v1 existente sigue verificando su contrato sin cambios.

**Resultados locales observados:** E2E de factura v2 10/10, E2E Afiliaciones→Billing→XML 1/1, contrato OpenAPI v2 1/1, regresión v1 de rutas/artefactos 18/18, prueba unitaria nueva 2/2. La suite unitaria completa pasó con 122 suites y 1377 pruebas aprobadas (3 suites y 13 pruebas omitidas). `npm run test:safety:static`, build, typecheck y lint pasan; lint informa 26 advertencias preexistentes sin errores. Las 28 migraciones Billing y las 6 de Afiliaciones se aplicaron únicamente en bases tmpfs creadas por estos runners. El XML descargado en el E2E cruzado coincide byte a byte con `FiscalXmlArtifact.signedXmlStorageKey` y con el SHA-256 persistido; la referencia comercial permanece en Afiliaciones.

La primera corrida de regresión E2E completa aprobó 29/31 suites y 200/202 pruebas. Falló `fiscal-onboarding-wave8-integration` porque el worktree aislado no es contiguo al checkout de Inventori y la prueba usa una ruta relativa por defecto. Falló `fiscal-xml-signing` al preparar un documento v1 después de 70 segundos en esa corrida. Ambas suites pasaron juntas (2/2, 4/4) en una base descartable nueva, definiendo `INVENTORI_BILLING_CLIENT_PATH` con la ruta de solo lectura del cliente real. La **segunda corrida completa** con esa variable pasó: **31/31 suites, 202/202 pruebas**. Incluyó la descarga HTTP real desde Afiliaciones, la ruta nueva, la firma v1 y el cliente real de Inventori Wave 8.

**Reproducción:** instalar dependencias del commit base en el worktree; ejecutar `npm run typecheck`, `npm run lint:check`, `npm run build`, `npm run test:safety:static`, `npm test -- --maxWorkers=2`, `npx jest --config ./test/jest-wave2.json --runInBand w2-b2-lab.contract.spec.ts` y `npm run test:e2e:disposable -- w2-b2-persistent-invoice.e2e-spec.ts`. Para la prueba cruzada, preparar únicamente la base tmpfs W5 documentada en Afiliaciones `08afb95` y su API compilada, definir `AFILIACIONES_W5_ROOT` y `W5_TEST_DATABASE_URL`, y ejecutar `npm run test:e2e:disposable -- invoice-xml-affiliations.e2e-spec.ts`. Definir `INVENTORI_BILLING_CLIENT_PATH` con la ruta absoluta a `src/services/billing-api-client.service.js` de Inventori para la suite Wave 8 desde este worktree. El runner de Billing crea y elimina su propia base PostgreSQL 15 y credenciales sintéticas; Afiliaciones usa PostgreSQL 16 aparte. No usar bases existentes.

| Gate | Estado |
| --- | --- |
| `BILLING_V1_DOCUMENT_REUSE` | PASS local: mismo `FiscalEvidenceResolverService` y almacenamiento |
| `BILLING_V2_INVOICE_XML_DOWNLOAD` | PASS local: descarga HTTP, bytes y SHA-256 verificados |
| `BILLING_V2_DOCUMENT_SECURITY` | PASS local: scopes, clave, origen, empresa, ambiente e integridad |
| `INVENTORI_V1_COMPATIBILITY` | PASS local: rutas v1 sin cambios y regresión completa 31/31 |
| `AFFILIATIONS_W5_INTEGRATION` | PASS local: HTTP real y referencia fiscal en Afiliaciones |
| `PRODUCTION_READINESS` | BLOQUEADO: rutas v2 de laboratorio no habilitadas productivamente |
