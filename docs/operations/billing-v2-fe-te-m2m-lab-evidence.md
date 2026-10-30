# Billing M2M v2 — FE y TE en laboratorio

Fecha: 2026-10-29. Rama: `codex/billing-v2-fe-te-m2m`, desde `dac2ec8`. Afiliaciones e Inventori se inspeccionaron únicamente en lectura. Ningún emisor real, Hacienda, base productiva ni ruta productiva v2 se utilizó.

## Auditoría y adaptación

| Área | Contrato v1 existente | Adaptación v2 de laboratorio |
| --- | --- | --- |
| FE | `POST /api/v1/companies/{companyId}/fiscal-documents/{environment}/invoices`; receptor obligatorio; scope `invoices:write`. | `POST /api/v2/lab/companies/{companyId}/fiscal-documents/SANDBOX/invoices`; receptor obligatorio; scope `fiscal-v2:invoices:create`. |
| TE | Ruta v1 `tickets`; receptor opcional. | Nueva ruta v2 `tickets`; receptor opcional; scope `fiscal-v2:tickets:create`. |
| Emisor y aislamiento | Empresa, perfil fiscal, numeración y certificado propios del motor fiscal. | Mismo motor; identidad M2M ligada a consumidor, asociación, empresa, ambiente y scope. Comprobación antes de reservar y dentro de la transacción. |
| Línea fiscal | CABYS de 13 dígitos, unidad, impuestos y descuentos validados por Billing. | Proyección sintética estricta: CABYS de 13 dígitos; CRC; contado `01`; método único `01`, `02` o `04`; importe calculado con decimal exacto. Solo `LAB_TAXABLE_IVA_13_XML` y `LAB_EXEMPT_XML`. Estas etiquetas de laboratorio no aprueban tratamientos para ventas reales. |
| XML y firma | Serializador v4.4, XSD, firma y almacenamiento comunes para FE y TE. | Se reutilizan sin motor XML nuevo. Descarga del XML firmado original con comprobación SHA-256. |
| Estado y error | Estados de documento, artefacto y envío separados. | `GET .../{documentId}` devuelve estado local y códigos seguros `errors[{phase,code}]` de XML o envío, sin mensajes internos. `READY_TO_SUBMIT` no equivale a aceptación de Hacienda. |
| Idempotencia | Reserva v1 por operación fiscal. | `CREATE_INVOICE` y `CREATE_TICKET` son espacios separados; hash versionado distinto para TE; consulta por operación y reintento exacto recuperan la misma identidad. |

El contrato ejecutable está en `docs/contracts/billing-w2-b2-lab.v2.openapi.yaml`. La única migración nueva amplía la restricción de operación de `fiscal_idempotency_keys_v2`; no cambia el esquema de documentos ni de Inventori. El módulo `W2B2FiscalLabModule` se registra solo en pruebas y exige `NODE_ENV=test` y `SANDBOX`; `AppModule` no lo importa.

## Afiliaciones SPEC-08 W2 (lectura)

El snapshot `apps/api/src/cash/billing-adapter.ts` de Afiliaciones contiene `saleId`, tipo FE/TE, receptor opcional, CABYS, línea, impuesto, total, método y condición de contado. Puede mapear `saleId` a `externalOperationId` y a la clave idempotente; `CASH/CARD/TRANSFER` a `01/02/04`; sus líneas a `FiscalLine`; y el receptor ausente a TE. La cuenta BANK/CASH y el cobro permanecen en Afiliaciones; Billing no registra dinero ni debe duplicar cobros.

Ese adaptador W2 todavía apunta a v1 y no se ejecuta desde las rutas de caja. El snapshot no expresa por sí solo el `taxTreatment` de laboratorio ni un mapeo aprobado para cada categoría tributaria; `USD` y `NON_SUBJECT` siguen fuera del subconjunto. Por eso la compatibilidad estructural se verificó en lectura, pero la integración de caja con Billing v2 y la emisión fiscal operativa **siguen pendientes**. No se modificó Afiliaciones.

## Pruebas y reproducción

```powershell
npm ci --no-audit --no-fund
npm run db:generate
node scripts/test-safety/disposable-postgres.mjs run -- node scripts/test-safety/run-disposable-validation.mjs e2e w2-b2-persistent-invoice
node scripts/test-safety/disposable-postgres.mjs run -- node scripts/test-safety/run-disposable-validation.mjs e2e 'fiscal-documents.e2e-spec|fiscal-xml-signing.e2e-spec'
npm test -- --runInBand
npm run test:safety
npm run build
npm run typecheck
npm run lint:check
```

El guard `disposable-postgres.mjs` crea PostgreSQL 15 en contenedor temporal con `tmpfs`, aplica todas las migraciones desde cero y elimina el contenedor al finalizar. La suite FE/TE M2M pasó **14/14** pruebas HTTP con consumidor y certificados sintéticos. Incluye TE sin receptor, dos líneas gravada/exenta, XML firmado que valida XSD y SHA-256, FE con receptor, CABYS inválido, alcance, empresa, concurrencia, recuperación tras interrupción y lectura de un error terminal. El primer intento de esa suite expuso interferencia entre dos claves de prueba; se aisló la clave TE en otra asociación y la repetición completa pasó.

La regresión HTTP v1 de documentos y firma XML pasó **11/11** pruebas en otra base descartable; incluye FE y TE v1. `npm run build` y `npm run typecheck` pasaron. `npm run lint:check` terminó con **cero errores y cero advertencias** después de tipar tres pruebas que contenían 26 usos de `any`. Las cuatro suites tocadas por esa limpieza y por el manifiesto de migraciones pasaron **27/27**. El contrato OpenAPI se parseó como YAML y contiene seis rutas FE/TE.

Los controles de seguridad de bases y almacenamiento de pruebas pasaron **35/35**. La prueba de integridad de XML emite un log de discrepancia SHA-256 de manera intencional; la respuesta HTTP esperada es 422. La regresión HTTP v1 ejercitó un fallo de persistencia de PDF de manera intencional y pasó la suite.

La regresión unitaria completa, repetida después de actualizar el manifiesto y eliminar advertencias de lint, terminó con **122 suites y 1378 pruebas correctas**; 3 suites y 13 pruebas estaban omitidas por su configuración existente. Ambos snapshots pasaron. El primer intento de esa regresión había fallado únicamente porque faltaba la nueva migración en `billing-w0-migration-manifest.json`; se añadió su SHA-256 y la repetición pasó.

## Gates

| Gate | Estado |
| --- | --- |
| `BILLING_V2_FE` | `PASS_LAB`: FE real en el motor fiscal local, con XML firmado; ruta v2 solo de prueba. |
| `BILLING_V2_TE` | `PASS_LAB`: TE real sin receptor, firmado y validado contra XSD; no se basa en un mock. |
| `BILLING_V2_XML` | `PASS_LAB`: descarga y verificación SHA-256; error de integridad probado en FE. |
| `BILLING_V2_SECURITY` | `PASS_LAB`: scope, empresa, asociación, ambiente e idempotencia probados. |
| `INVENTORI_V1_COMPATIBILITY` | `PASS_LOCAL`: FE/TE HTTP v1 11/11; la regresión unitaria incluye snapshots de rutas y compatibilidad Inventori. |
| `AFFILIATIONS_SPEC08_W2_READINESS` | `CONTRACT_ONLY`: mapeo técnico identificado; adaptador W2 aún usa v1 y no se invoca. |
| `PRODUCTION_READINESS` | `BLOCKED`: ruta v2 no registrada en producto, clasificación tributaria real pendiente, sin prueba con Afiliaciones ni Hacienda. |

No hay PASS global ni activación productiva.
