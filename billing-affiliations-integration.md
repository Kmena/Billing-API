# Integración del nuevo sistema de afiliaciones con Billing

## Límite de responsabilidad

El sistema de afiliaciones es dueño de cliente comercial, plan, afiliación, períodos, obligación, saldo, pago, distribución, anticipo, excedente, reversión contable y decisión tributaria respaldada por el emisor. Debe mantener un **ledger inmutable** de aplicaciones de pago con identificadores estables y una versión de política fiscal por línea. Billing es dueño de emisor fiscal, consecutivo/clave, snapshot del documento, XML, firma, envío, respuesta de Hacienda, PDF, entrega y documentos correctivos. Billing nunca debe reconstruir un saldo comercial desde un XML ni cambiar una factura aceptada en sitio.

La unidad de integración es un **FiscalIntent** del nuevo sistema: `tenant/company/environment`, `externalOperationId`, versión tributaria, tipo de operación, asignaciones a obligaciones y líneas fiscales congeladas. Cada línea lleva `affiliationId`, `periodId` y `allocationId` como referencias comerciales del productor (propuesta contractual, actualmente no campos fiscales dedicados), descripción visible de concepto y período, CABYS, cantidad, precio/base, descuento, tarifa/código/monto tributario y moneda/tasa. Billing recibe solamente el payload fiscal aprobado; la trazabilidad comercial se conserva fuera de Billing y se vincula a `fiscalDocumentId`/`clave`. Si se necesitan referencias comerciales consultables desde Billing, añadir metadatos externos no fiscales versionados, inmutables y sin información sensible excesiva.

## Contrato existente observado

Todos los paths tienen prefijo `/api/v1`. `:environment` es `SANDBOX` o `PRODUCTION`; `companyId` debe corresponder a una empresa vinculada a la API key. La siguiente tabla identifica el contrato **existente**, no promete que un perfil nuevo pueda invocarlo sin alta y pruebas. Los OpenAPI de `docs/contracts/` cubren onboarding/identidad/equivalencia; no hay un OpenAPI versionado integral de este flujo.

| Operación | Endpoint actual | Auth y scope | Idempotencia / prueba / límite |
|---|---|---|---|
| Asociar emisor | `POST /fiscal-onboarding/v1/associations` o `/bootstrap` | JWT `TENANT_ADMIN` o API key `fiscal-bootstrap:provision` | Asociación idempotente según contrato v1; perfil `inventori-*`; E2E onboarding; diseñar perfil neutral |
| Leer/actualizar emisor | `GET/PATCH /companies/:id/fiscal-onboarding/v1/:env/issuer` | API key `fiscal-issuer:read/write` | E2E onboarding; empresa vinculada |
| Perfil, actividades, sucursales, terminales y secuencias | bajo `/companies/:id/fiscal-onboarding/v1/:env/{profile,activities,branches,terminals,issuance-points,sequences}` | `fiscal-profile:*`, `fiscal-activities:*`, `fiscal-issuance-points:*`, `fiscal-sequences:*` | Control de concurrencia/configuración debe probarse para segundo consumidor |
| Credenciales/certificado | `.../hacienda-connection`, `.../certificate`; existe además `PUT /companies/:id/fiscal-onboarding/:env/hacienda-credentials` | `fiscal-credentials:*`, `fiscal-certificates:*`; alternativa JWT admin | Secretos no retornan; pruebas de seguridad locales; separar permisos de emisión y administración |
| Elegibilidad | `GET /companies/:id/fiscal-onboarding/v1/:env/readiness` | `fiscal-readiness:read` | E2E de consistencia; estado puntual, puede cambiar antes de emisión |
| Crear FE/TE | `POST /companies/:id/fiscal-documents/:env/invoices` o `/tickets` | API key `invoices:write` / `tickets:write` | `Idempotency-Key` exigida por servicio; headers opcionales de equivalencia v1; E2E; `CreateFiscalDocumentDto` solo CRC/USD, una imposición por línea |
| Recuperar identidad tras timeout | `GET .../identity-by-idempotency`, `POST .../identity-by-fiscal-evidence` | API key y scope según operación, ver YAML v1/v2 | Compara identidad fiscal en empresa/ambiente/tipo; pruebas unitarias/E2E; no equivale a búsqueda comercial libre |
| Preparar XML | `POST /fiscal-documents/:id/prepare-xml` | API key, autorización resuelta en servicio por tipo | Persistencia/firma/XSD E2E; separar fallo de preparación de rechazo Hacienda |
| Enviar y consultar | `POST .../invoices/:id/submit`, `GET .../invoices/:id/submission`, `POST .../invoices/:id/submission/reconcile` (análogos `tickets`) | `invoices:write` / `tickets:write` incluso lectura de submission | E2E worker; POST/HTTP 202 no significa aceptación; polling hasta terminal |
| Recuperar documento y evidencias | `GET /fiscal-documents/:id`; `GET .../invoices/:id/artifacts[/:artifactId/download]` (análogos TE) | API key; `invoices:read` / `tickets:read` en artefactos | XML/PDF/respuesta cuando existan; verificar hash, autorización y estado |
| Entrega y reenvío | `GET/POST .../invoices/:id/deliveries`; `POST .../invoices/:fiscalDocumentId/accepted-package-resend` | `invoices:read/write`, `fiscal-deliveries:resend` | E2E mock; reenvío aceptado requiere documento/paquete auténtico; validar SMTP real |
| Claves API | `POST/GET/DELETE /api-keys`, `POST /api-keys/:id/companies` | JWT `TENANT_ADMIN` | Emisión/rotación administrativa; no exponer secreto después de alta |

`GET /fiscal-documents/:id` y `prepare-xml` no llevan `companyId` en la URL: sus servicios deben mantener autorización por tenant, empresa vinculada y scope de tipo. Esta condición requiere pruebas negativas específicas con ambas aplicaciones. El callback `/hacienda/callback` recibe avisos **de Hacienda**; no es un webhook saliente para consumidores.

## Contratos que faltan

1. **Perfil de consumidor `affiliations-fiscal-v1`:** bootstrap solo de administrador, API key por empresa y ambiente; scopes mínimos `fiscal-readiness:read`, `invoices:write/read`, `tickets:*` solo si aplica, `fiscal-deliveries:resend` opcional. Rotación/revocación sin perder idempotencia histórica. Separar credenciales Hacienda y certificado en un rol operador, no en la clave ordinaria de cobros.
2. **Emisión correctiva:** `POST .../credit-notes` y `/debit-notes`, lectura, preparación, envío, estado y artefactos. Solicitud con `sourceFiscalDocumentId`, clave/consecutivo/tipo original, motivo/código de referencia vigente, líneas/importe exacto, `externalReversalId`, `Idempotency-Key`. Respuesta con nueva identidad, suma corregida y estado. Rechazar original no aceptado, otro emisor/ambiente, exceso acumulado y conflicto de payload. Preservar original y todas las notas.
3. **REP condicional:** operación separada con factura a crédito referenciada, saldo y pago aplicable solo tras decisión tributaria del supuesto. No modelar como FE adicional automática.
4. **Contrato fiscal de líneas v2:** tratamiento explícito `TAXABLE`, `EXEMPT`, `NON_SUBJECT`, `ZERO_RATE`, `EXONERATED`; arreglo de impuestos cuando aplique; soportes de exoneración; moneda/tasa y base precisas; política de precios incluidos; identificación extranjera. Versionar hash canónico y compatibilidad con v1 sin reinterpretar snapshots anteriores.
5. **Notificación al consumidor:** evento `fiscal.document.accepted|rejected|manual_review|required_action|delivery_failed|corrected`, con `eventId`, secuencia por documento, `companyId`, `environment`, `fiscalDocumentId`, `clave`, tipo, versión y hora. Outbox transaccional, firma HMAC/mTLS, reintentos, deduplicación y replay con cursor. Mientras no exista, usar polling contractual documentado con límites y reconciliación tras reinicio.
6. **OpenAPI versionado de ciclo fiscal:** schemas de emisión, cabeceras de idempotencia/equivalencia, estados separados (`document`, `submission`, `delivery`), errores estables, artefactos, rechazo, reemplazo, notas y eventos; fixtures de productor/consumidor y pruebas contractuales.

## Reglas de integridad de la integración

- Un `externalOperationId`/`allocationId` de origen se liga a una sola identidad fiscal canónica por emisor, ambiente, tipo y versión de payload. El reintento idéntico recupera identidad; cambio de línea, impuesto, moneda, receptor o período requiere una operación nueva y corrección fiscal si ya hubo aceptación.
- La suma de líneas fiscales debe igualar los importes aplicados a obligaciones **facturables** después de decidir momento fiscal; separar redondeo, descuentos, impuesto, excedente no aplicado y anticipos. Un excedente futuro no se presenta como servicio ya prestado sin fundamento tributario.
- FE emitida y aceptada se corrige por NC/ND; FE rechazada se investiga y sustituye según causa, sin NC. El consumidor no marca pago comercial irreversible solo por `202` o `ACKNOWLEDGED`.
- XML firmado, respuesta Hacienda y PDF deben compartir `clave`, importes y tratamiento; el estado de entrega no reemplaza la aceptación fiscal.
- No reutilizar clave API de Inventori, tablas de Inventori ni referencias de credenciales de otra empresa. Ensayar matriz tenant A/B, empresa A/B, ambiente SANDBOX/PRODUCTION, key vigente/revocada y scopes de lectura/escritura.

## Escenarios de afiliaciones

| # | Escenario | Representación/flujo esperado | Estado hoy |
|---|---|---|---|
| 1 | Afiliación exenta | Línea de servicio y período con CABYS validado, IVA `01`, tarifa `10`, monto 0 y fundamento registrado por productor | Parcial; XSD local, sin STAG/criterio por emisor |
| 2 | Afiliación gravada | Línea por período, base, IVA y total; pago y hecho generador concordantes | FE gravada viable local/STAG histórico |
| 3 | Pago de un período | Una aplicación → intent y línea fiscal; reconciliar FE y pago | Requiere contrato de productor |
| 4 | Varios períodos, una transacción | Una FE con líneas por período o varias FE conforme decisión; idempotencia de cada unidad | Factura multilínea existe; semántica comercial falta |
| 5 | Pago parcial | Separar saldo comercial; definir si FE de cuota devengada ya existe y si REP aplica | Bloqueado por criterio fiscal/REP condicional |
| 6 | Varias afiliaciones de un cliente | Líneas independientes con `affiliationId`/período/asignación; mismo emisor/receptor/moneda | Factura multilínea existe; referencias externas faltan |
| 7 | Pago anticipado | Guardar pasivo/anticipo y decidir cuándo emitir documento | Decisión fiscal pendiente |
| 8 | Excedente futuro | No mezclar automáticamente con base de servicio actual; aplicación posterior trazable | Decisión fiscal y contrato pendientes |
| 9 | Cancelación | Detener períodos futuros; corregir solo comprobantes válidos afectados | NC ausente |
| 10 | Reversión de pago facturado | Reverso comercial y NC referenciada por importe/lineas; auditoría de ambos | NC ausente |
| 11 | Corrección parcial | NC parcial y, si procede, nueva FE/ND; límite acumulado | NC/ND ausentes |
| 12 | Rechazo Hacienda | Registrar rechazo y causa; nueva emisión controlada sin NC | Parcial; falta contrato consumidor |
| 13 | Interrupción | Lookup por idempotencia/evidencia, reanudar estados, no duplicar consecutivo | Parcial; ensayo cruzado pendiente |
| 14 | Reenvío aceptado | Recuperar paquete autenticado, mismo XML/PDF/respuesta y hash | Implementado; SMTP real pendiente |
| 15 | Cliente extranjero | Identidad/dirección y calificación de exportación según caso | No soportado por validador FE actual |
| 16 | Monedas distintas | CRC/USD existentes; tasa y política de conversión congeladas por intent | Parcial; otras monedas ausentes |

## Estados de fallo

El consumidor guarda `FiscalIntent=PENDING` antes de llamar; en timeout consulta identidad por idempotencia/evidencia. `READY_FOR_XML`, `READY_TO_SUBMIT`, `ACKNOWLEDGED/PROCESSING` y `POST_OUTCOME_UNKNOWN` son estados no terminales; se reconsulta/reconcilia con backoff y límite operativo. `ACCEPTED` habilita cierre fiscal; `REJECTED` abre incidente de corrección/reemisión; `MANUAL_REVIEW_REQUIRED` bloquea emisión paralela; `DELIVERY_FAILED` exige reenvío del mismo comprobante. Cada transición se registra con correlation ID y versión del payload. Esta máquina entre sistemas es **diseño propuesto** hasta tener pruebas de contrato.
