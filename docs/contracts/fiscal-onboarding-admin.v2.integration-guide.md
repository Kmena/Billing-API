# SPEC-09 Frente B — onboarding fiscal M2M v2 (laboratorio)

## Estado y frontera

`FiscalOnboardingAdminV2LabModule` registra el contrato de `fiscal-onboarding-admin.v2.openapi.yaml` solo cuando se importa explícitamente en un proceso con `NODE_ENV=test`. `AppModule` no importa este módulo. No existe activación productiva automática. La asociación y la clave inicial siguen requiriendo un administrador de Billing con JWT en el contrato de consumidor v2 de laboratorio; después se usa `X-API-Key` para las operaciones M2M. Afiliaciones debe llamar desde su servidor, nunca desde el navegador ni exponer la clave en JavaScript.

El prefijo es `/api/v2/companies/{companyId}/fiscal-onboarding/{environment}`. La clave está vinculada por `FiscalConsumerKeyBinding` a una asociación, compañía y ambiente. El guard valida hash Argon2, expiración, estado, tenant, ambiente y scope antes de leer o escribir. `Origin` presente se rechaza para evitar usar la clave desde un navegador. No se aceptan datos de tenant, compañía o ambiente en el body.

## Matriz de reutilización v1/v2

| Capacidad | Ruta o componente real v1 | Adaptador v2 de laboratorio | Almacén compartido |
|---|---|---|---|
| Emisor y asociación | `POST /api/v1/fiscal-onboarding/v1/associations`, `GET/PATCH .../issuer`; `FiscalOnboardingV1Service` | `GET/PUT issuer`, confirmación `POST associations`, sucesión `POST associations/reassign` | `Company`, `FiscalConsumer*`; `FiscalIntegrationAssociation` permanece exclusivo de Inventori v1 |
| Certificado y PIN | `POST/PUT .../certificate`; `UploadFiscalSigningCertificateService` | `POST certificate`, `GET certificate` | `FiscalSigningCertificate` y `SecretProvider` |
| Hacienda | `PUT/POST .../hacienda-connection`; `ConfigureConnectionHandler` | `PUT credentials`, `POST credentials/rotate` | `HaciendaConnection` y `SecretProvider` |
| Sucursal y terminal | `POST .../branches`, `POST .../branches/{id}/terminals`, `PUT .../issuance-points/default` | `PUT issuance-point` | `FiscalBranch`, `FiscalTerminal`, `FiscalIssuancePoint` |
| Estado | `GET .../readiness`; `FiscalOnboardingV1Service.evaluateReadiness` | `GET status`, `GET /` | Mismas tablas fiscales |
| Prueba técnica | `POST .../hacienda-connection/validate` (puede autenticar con Hacienda según configuración) | `POST connection-test` (solo consultas locales) | Mismas tablas; no se emite documento |
| Auditoría | `AuditService`, `AuditLog`; eventos v1 sin lectura M2M dedicada | `GET audit` (proyección segura) | `AuditLog` |
| Sucesión | `PrismaConsumerV2Repository.reassignIssuer` en laboratorio | `POST associations/reassign` | Asociaciones v2, claves y auditoría; snapshots históricos intactos |

## Scopes

`fiscal-v2:onboarding:read`, `fiscal-v2:onboarding:issuer:write`, `fiscal-v2:onboarding:association:write`, `fiscal-v2:onboarding:certificate:write`, `fiscal-v2:onboarding:credentials:write`, `fiscal-v2:onboarding:issuance-point:write`, `fiscal-v2:onboarding:connection:test`, `fiscal-v2:onboarding:audit:read`. La emisión de FE y TE requiere adicionalmente `fiscal-v2:invoices:create` y `fiscal-v2:tickets:create`; `connection-test` informa ambas capacidades usando la clave actual. Los scopes no conceden autorización productiva de Hacienda.

## Flujos para la Web de Afiliaciones

1. Un administrador de Billing crea la asociación v2 para el emisor autorizado y emite una clave v2 con los scopes mínimos desde las rutas administrativas JWT del laboratorio. La Web guarda la clave solo en su servidor o gestor de secretos; el navegador solo recibe estados y metadatos seguros.
2. El backend de Afiliaciones consulta `GET /` y `GET /status`. La identidad legal existente no se puede cambiar con `PUT issuer`; para otro emisor se usa la sucesión tras verificar el emisor destino.
3. El backend sube `multipart/form-data` con `certificate` (PKCS#12, `application/x-pkcs12`, máximo 1 MiB) y `pin`. El PIN y el archivo se transmiten solo al servidor Billing por TLS y no se reenvían en respuestas. El servicio existente comprueba PIN, estructura, identidad y fechas y guarda bytes/PIN mediante `SecretProvider` durable.
4. `PUT credentials` configura un par inicial de usuario/contraseña. `POST credentials/rotate` guarda una referencia nueva, invalida el token cacheado y elimina la referencia anterior tras confirmar la actualización. La respuesta contiene solo estado. La configuración queda en `PENDING_VALIDATION` hasta validación por el flujo autorizado; la prueba local no autentica ante Hacienda.
5. `PUT issuance-point` crea o reutiliza sucursal/terminal y selecciona el punto predeterminado. `POST connection-test` devuelve `technicalConnection` (`READY` o `INCOMPLETE`) y `productionAuthorization: NOT_VERIFIED` con checks locales. El frontend debe mostrar ambas dimensiones por separado.
6. `POST associations` confirma idempotentemente el vínculo actual; rechaza otra clave externa. `POST associations/reassign` comprueba destino, operaciones pendientes y asociación activa bajo transacción serializable. Crea sucesor, suspende la asociación anterior, revoca sus claves y registra auditoría. Los documentos emitidos conservan su emisor y `originAssociationId` históricos. Afiliaciones debe renovar su clave para el sucesor.

Errores de seguridad frecuentes: `401 CONSUMER_KEY_UNAUTHORIZED`; `403 INSUFFICIENT_SCOPE`, `CONSUMER_ENVIRONMENT_NOT_AUTHORIZED`, `ONBOARDING_BROWSER_ORIGIN_FORBIDDEN`; `404 CONSUMER_RESOURCE_NOT_FOUND`; `409 ISSUER_LEGAL_IDENTITY_IMMUTABLE`, `ISSUER_PENDING_OPERATIONS`, `HACIENDA_CONNECTION_CONCURRENT_CONFLICT`, `CONSUMER_ASSOCIATION_PENDING_OPERATIONS`; `422 CONSUMER_TARGET_ISSUER_NOT_READY` o error de certificado. No registrar cuerpos, archivos, PIN, claves ni contraseñas en Afiliaciones. Usar un identificador de correlación propio en su backend para trazabilidad.

## Brechas para integración directa

- El módulo es de laboratorio y no está activado en `AppModule`; falta revisión de seguridad y un gate separado para registro productivo.
- La primera asociación y emisión de clave requieren JWT de administrador de Billing. Afiliaciones necesita un proceso de provisión administrado; la clave M2M enlazada no puede crear su propio primer vínculo.
- `connection-test` verifica estado almacenado, referencias y capacidades, pero no prueba autenticación con Hacienda ni autorización productiva. No debe presentarse como validación de credenciales.
- Las escrituras que delegan a servicios v1 (certificado, credenciales y sucursal/terminal) revalidan el principal inmediatamente antes de ejecutarse, pero no comparten una transacción con la asociación v2. Es necesaria una revisión de carrera suspensión/escritura antes del gate de seguridad productiva.
- El evento v1 de credenciales/certificado usa `AuditService.record` no bloqueante; la auditoría v2 de credenciales se escribe después de la mutación. Una falla de auditoría puede dejar una mutación sin evento v2. Exigir auditoría transaccional o una salida durable antes de habilitar producción.
- La eliminación de una referencia anterior de Hacienda después de rotar no es atómica con la actualización de la conexión. Una falla del proveedor de secretos puede dejar un secreto huérfano; necesita compensación verificable y alarma antes de producción.
- Los contratos v1 de Inventori conservan sus rutas y DTO sin cambios, pero su regresión HTTP debe ejecutarse con PostgreSQL descartable antes de declarar compatibilidad.

## Gates (no inferir PASS por compilación)

| Gate | Estado verificado en laboratorio |
|---|---|
| BILLING_ONBOARDING_V1_REUSE | PASS técnico: mismos servicios y almacenes; v1 e Inventori Wave 8 HTTP 10/10 |
| BILLING_ONBOARDING_V2_CONTRACTS | PASS de laboratorio: contrato y 3/3 HTTP SPEC-09 |
| BILLING_ONBOARDING_V2_SECURITY | PENDIENTE: carrera entre guard y servicios v1, auditoría y rotación |
| BILLING_ISSUER_ASSOCIATION | PASS de laboratorio: sucesión transaccional v2 y bloqueo por pendientes en W1-D2 HTTP |
| BILLING_CREDENTIAL_ROTATION | Rotación sintética HTTP verificada; compensación pendiente |
| BILLING_CONNECTION_TEST | PASS local: checks sin Hacienda ni emisión, 3/3 HTTP SPEC-09 |
| INVENTORI_V1_COMPATIBILITY | PASS de laboratorio: contratos v1 intactos y Wave 8 con cliente Inventori 10/10 HTTP |
| BILLING_SPEC09_TECHNICAL_PASS | PENDIENTE hasta cerrar las brechas de seguridad y provisión inicial M2M |
| PRODUCTION_READINESS | NO APROBADO; rutas v2 desactivadas |

## Evidencia ejecutada

- `node scripts/test-safety/disposable-postgres.mjs run -- node scripts/test-safety/run-disposable-validation.mjs e2e spec09-onboarding-v2-lab.e2e-spec.ts`: 3/3 HTTP, PostgreSQL efímero, PKCS#12 sintético y PIN inválido/válido.
- Regresión HTTP `fiscal-onboarding-v1.e2e-spec.ts|fiscal-onboarding-wave8-integration.e2e-spec.ts`: 10/10, cliente Inventori local sin modificaciones.
- Regresión HTTP `w1-d2-consumer-lab.e2e-spec.ts|spec09-onboarding-v2-lab.e2e-spec.ts`: 13/13, asociación, sucesión, pendientes y rotación de claves.
- Jest focalizado de política v2, v1, certificados, firma y XML: 172/178 en sandbox; los seis fallos eran del subproceso XSD Python bloqueado. La suite XSD 1.1 completa pasó 9/9 con acceso al subproceso local.
- `npm run build`, `tsc --noEmit --incremental false`, lint focalizado SPEC-09, `git diff --check` y parseo OpenAPI YAML: aprobados. El lint completo encontró tres diferencias de Prettier solo en archivos SPEC-09; se corrigieron y el lint focalizado pasó.
