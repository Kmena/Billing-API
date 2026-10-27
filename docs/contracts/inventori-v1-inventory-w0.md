# Inventori ↔ Billing v1: inventario congelado en W0

Fuente del consumidor: `Kmena/inventory-api`, commit `edb1e05186d296e3699c71306913f16aee470d1e`, archivo `inventory-api/src/services/billing-api-client.service.js`, SHA-256 de sus bytes Git `1bc069fa657569ce3c489b633775adea8ba362bbe3c3f19e0051209c88ea9da0`. El checkout local de Inventori estaba en otro commit; este inventario se extrajo con `git show` del commit fijado por `.github/workflows/ci.yml`. Las 42 combinaciones de método y ruta siguientes aparecen en ese cliente; esto indica capacidad de invocación, no prueba de uso productivo de cada una.

Todas las rutas llevan el prefijo `/api/v1`. Variables: `{companyId}`, `{environment}`, `{id}`, `{branchId}`, `{terminalId}`, `{documentType}`, `{executionId}` y `{artifactId}`. Los paths reales se contrastaron con controladores Nest; la prueba `inventori-v1-route-contract.spec.ts` fija ruta, verbo, guardas y scopes de nueve rutas críticas. El E2E `fiscal-onboarding-wave8-integration.e2e-spec.ts` carga el cliente real fijado y prueba un recorrido de bootstrap, configuración, readiness, identidad y rotación sobre DB descartable.

| Grupo | Rutas consumibles por el cliente fijado | Pares verbo/ruta |
|---|---|---:|
| Onboarding legado | `GET companies/{companyId}/fiscal-onboarding/status`; `PUT` y `POST …/fiscal-onboarding/{environment}/hacienda-credentials[/validate]`; `GET …/fiscal-onboarding/{environment}/readiness` | 4 |
| Bootstrap v1 | `POST fiscal-onboarding/v1/bootstrap` | 1 |
| Actividades v1 | `GET …/activities`, `POST …/activities/refresh`, `PATCH …/activities/{code}`, `PUT …/activities/default` | 4 |
| Estado y prueba v1 | `GET …/readiness`, `POST …/test-invoices`, `GET …/test-invoices/{executionId}` | 3 |
| Emisor y perfil v1 | `GET/PATCH …/issuer`, `GET/PUT …/profile` | 4 |
| Conexión y certificado v1 | `GET/PUT …/hacienda-connection`, `POST …/hacienda-connection/validate`, `POST …/hacienda-connection/disable`, `GET/POST/PUT …/certificate` | 7 |
| Sucursales, terminales y secuencias v1 | `GET/POST …/branches`, `PATCH …/branches/{branchId}`, `POST …/branches/{branchId}/terminals`, `PATCH …/terminals/{terminalId}`, `GET/PUT …/issuance-points/default`, `GET …/terminals/{terminalId}/sequences/{documentType}`, `PUT …/terminals/{terminalId}/sequences/{documentType}/initial` | 9 |
| Ciclo de factura | `POST companies/{companyId}/fiscal-documents/{environment}/invoices`, `GET …/identity-by-idempotency`, `POST …/identity-by-fiscal-evidence`, `POST fiscal-documents/{id}/prepare-xml`, `POST …/invoices/{id}/submit`, `POST …/invoices/{id}/accepted-package-resend`, `GET fiscal-documents/{id}`, `GET …/invoices/{id}/submission`, `GET …/invoices/{id}/artifacts`, `GET …/invoices/{id}/artifacts/{artifactId}/download` | 10 |

En las filas con `…` de onboarding v1, la base es `companies/{companyId}/fiscal-onboarding/v1/{environment}`; en las de factura, `companies/{companyId}/fiscal-documents/{environment}`. El cliente genera la descarga de artefacto con `fetchImpl` y el verbo de escritura del certificado con `replace ? PUT : POST`; ambas variantes se incluyeron aunque no aparecen como `method: 'VERB'` literal.

## Contratos y protección

| Artefacto existente | SHA-256 |
|---|---|
| `fiscal-onboarding.v1.openapi.yaml` | `aad6b26208c9d900fa9d25964d64f50639ed5c57c935ad1892301da74df60279` |
| `fiscal-identity-lookup.v1.openapi.yaml` | `ba434e1d4086878757ebf972802055408da0f597f95b27afbc1c1c740cb50988` |
| `fiscal-payload-equivalence.v1.openapi.yaml` | `0aca6287e5d45dd48906a42732172644446beb174c93c7d15fe47a17ec366019` |
| `fiscal-identity-evidence-lookup.v2.openapi.yaml` | `bd9e58f1ce613749fcef8629570b5fce841d5d52e8ded676e0c34bfed0ccbb9e` |

La última especificación se llama v2 por el esquema de evidencia, pero su endpoint actual está bajo `/api/v1`; renombrar o mover el path rompería al cliente. El golden fixture `fixtures/fiscal-payload-equivalence.v1/inv-966-historical-sanitized.json` ya se verifica por `fiscal-payload-equivalence.spec.ts`. El contrato lookup tiene fixtures de éxito, ausencia, conflicto, error de integridad y autorización; onboarding tiene catálogo de operaciones y fixtures de autorización/readiness. Las guardas de clave API y los scopes declarados se verifican además en la nueva prueba de rutas críticas, sin cambiar valores.

## Coexistencia futura

`/api/v2` se agregará con controladores, DTO, autenticación y OpenAPI propios después de los ADR de W1/W2. El prefijo `/api/v1`, el perfil `inventori-fiscal-v1`, los headers actuales, errores, cuerpos, idempotencia y permisos conservan su semántica. La prueba de cliente fijado debe pasar antes de integrar cada wave; agregar v2 no autoriza trasladar o reinterpretar rutas v1.
