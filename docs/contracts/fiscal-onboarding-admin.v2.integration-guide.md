# SPEC-09 Frente B — onboarding fiscal M2M v2 (laboratorio)

## Estado y frontera

`FiscalOnboardingAdminV2LabModule` registra el contrato de `fiscal-onboarding-admin.v2.openapi.yaml` solo cuando se importa explícitamente en un proceso con `NODE_ENV=test`. `AppModule` no importa este módulo. No existe activación productiva automática. La primera asociación SANDBOX puede hacerse con el comando administrativo local `scripts/spec09-bind-affiliations-lab.ts`; verifica contraseña, rol activo de `TENANT_ADMIN`, emisor, tenant y marcador de PostgreSQL descartable. La API administrativa JWT también confirma la asociación, pero una clave M2M no puede crear su primer vínculo. Afiliaciones debe usar `X-API-Key` solo desde su servidor y nunca exponerla en JavaScript.

El prefijo es `/api/v2/companies/{companyId}/fiscal-onboarding/{environment}`. La clave está vinculada por `FiscalConsumerKeyBinding` a una asociación, compañía y ambiente. El guard valida hash Argon2, expiración, estado, tenant, ambiente y scope antes de leer o escribir. `Origin` presente se rechaza para evitar usar la clave desde un navegador. No se aceptan datos de tenant, compañía o ambiente en el body.

## Matriz de reutilización v1/v2

| Capacidad | Ruta o componente real v1 | Adaptador v2 de laboratorio | Almacén compartido |
|---|---|---|---|
| Emisor y asociación | `POST /api/v1/fiscal-onboarding/v1/associations`, `GET/PATCH .../issuer`; `FiscalOnboardingV1Service` | `GET/PUT issuer`, confirmación M2M `POST associations`; sucesión solo por administrador Billing | `Company`, `FiscalConsumer*`; `FiscalIntegrationAssociation` permanece exclusivo de Inventori v1 |
| Certificado y PIN | `POST/PUT .../certificate`; extractor de identidad fiscal | `POST certificate`, `GET certificate`; escritor transaccional v2 | `FiscalSigningCertificate` y `SecretProvider` existentes |
| Hacienda | `PUT/POST .../hacienda-connection` | `PUT credentials`, `POST credentials/rotate`; escritor transaccional v2 | `HaciendaConnection`, `HaciendaTokenCache` y `SecretProvider` existentes |
| Sucursal y terminal | `POST .../branches`, `POST .../branches/{id}/terminals`, `PUT .../issuance-points/default` | `PUT issuance-point` en una transacción con autorización y auditoría | `FiscalBranch`, `FiscalTerminal`, `FiscalIssuancePoint` |
| Estado | `GET .../readiness`; `FiscalOnboardingV1Service.evaluateReadiness` | `GET status`, `GET /` | Mismas tablas fiscales |
| Prueba técnica | `POST .../hacienda-connection/validate` (puede autenticar con Hacienda según configuración) | `POST connection-test` (solo consultas locales) | Mismas tablas; no se emite documento |
| Auditoría | `AuditService`, `AuditLog`; eventos v1 sin lectura M2M dedicada | `GET audit` (proyección segura) | `AuditLog` |
| Sucesión | `PrismaConsumerV2Repository.reassignIssuer` en laboratorio | `POST /api/v2/integrations/consumers/{consumerId}/associations/{associationId}/reassign` con JWT y rol Billing vigente | Asociaciones v2, claves y auditoría; snapshots históricos intactos |

## Scopes

`fiscal-v2:onboarding:read`, `fiscal-v2:onboarding:issuer:write`, `fiscal-v2:onboarding:association:write`, `fiscal-v2:onboarding:certificate:write`, `fiscal-v2:onboarding:credentials:write`, `fiscal-v2:onboarding:recovery:write`, `fiscal-v2:onboarding:issuance-point:write`, `fiscal-v2:onboarding:connection:test`, `fiscal-v2:onboarding:audit:read`. La emisión de FE y TE requiere adicionalmente `fiscal-v2:invoices:create` y `fiscal-v2:tickets:create`; `connection-test` informa ambas capacidades usando la clave actual. Los scopes no conceden autorización productiva de Hacienda.

## Flujos para la Web de Afiliaciones

1. Un administrador de Billing ejecuta localmente `scripts/spec09-bind-affiliations-lab.ts <tenantId> <companyId> <adminEmail> <externalConsumerKey> <externalCompanyKey>` con la contraseña por **stdin**, nunca como argumento. El comando solo acepta una base PostgreSQL descartable marcada por el arnés de pruebas y crea una asociación `AFFILIATIONS`/`SANDBOX`. Repetir los mismos datos devuelve la misma asociación con `created: false`; otro emisor para la misma clave externa devuelve 409. El comando no emite claves. El administrador emite la clave inicial mediante `POST /api/v2/integrations/consumers/{consumerId}/keys`, con JWT administrativo y scopes mínimos; Billing revalida el rol activo dentro de la transacción. Si se pierde la única respuesta con la clave, el administrador debe revocar esa clave y emitir otra. Afiliaciones guarda la clave solo en su backend o gestor de secretos.
2. El backend de Afiliaciones consulta `GET /` y `GET /status`. La identidad legal existente no se puede cambiar con `PUT issuer`; para otro emisor se usa la sucesión tras verificar el emisor destino.
3. El backend sube `multipart/form-data` con `certificate` (PKCS#12, `application/x-pkcs12`, máximo 1 MiB) y `pin`, más `Idempotency-Key` de 8 a 128 caracteres. El PIN y el archivo se transmiten solo al servidor Billing por TLS y no se reenvían en respuestas. Billing comprueba PIN, estructura, identidad y fechas y guarda bytes/PIN mediante el `SecretProvider` durable existente. El ledger durable guarda referencias y un HMAC del pedido, nunca el PIN o el archivo. Un certificado sustituido conserva su custodia cifrada y estado `REPLACED` para el historial fiscal.
4. `PUT credentials` configura el par inicial y `POST credentials/rotate` lo rota. Ambas requieren `Idempotency-Key`; repetir la misma clave y contenido devuelve la respuesta segura previa, mientras otro contenido devuelve 409. Billing prepara una referencia nueva, vuelve a verificar clave M2M, asociación, ambiente y scope bajo bloqueo en la transacción que activa la configuración y escribe la auditoría. Una falla antes del commit compensa la referencia nueva. Tras el commit invalida la caché y retira la referencia anterior; si falla la limpieza, el ledger deja `COMMITTED_CLEANUP_PENDING`. La configuración queda en `PENDING_VALIDATION`; la prueba local no autentica ante Hacienda.
5. `PUT issuance-point` crea o reutiliza sucursal/terminal y selecciona el punto predeterminado. `POST connection-test` devuelve `technicalConnection` (`READY` o `INCOMPLETE`) y `productionAuthorization: NOT_VERIFIED` con checks locales. El frontend debe mostrar ambas dimensiones por separado.
6. `POST associations` confirma idempotentemente el vínculo actual; rechaza otra clave externa. Una clave M2M no puede reasignar el emisor. Un administrador de Billing usa `POST /api/v2/integrations/consumers/{consumerId}/associations/{associationId}/reassign` con JWT; Billing comprueba su rol vigente dentro de la transacción, el destino, las operaciones pendientes y la asociación activa. Crea sucesor, suspende la asociación anterior, revoca sus claves y registra auditoría. Los documentos emitidos conservan su emisor y `originAssociationId` históricos. Afiliaciones debe recibir una clave nueva para el sucesor.
7. Ante `ONBOARDING_OPERATION_RECOVERY_REQUIRED`, un operador con `fiscal-v2:onboarding:recovery:write` llama `POST mutations/{operationId}/recover`. Un `STAGED` reciente devuelve 409; después de diez minutos se marca para recuperación bajo bloqueo antes de borrar referencias. Repetir la recuperación es seguro. `FISCAL_ONBOARDING_V2_HMAC_KEY` debe ser una clave secreta estable de al menos 32 caracteres en el proceso de laboratorio; si falta, las mutaciones con secretos fallan cerradas.

Errores de seguridad frecuentes: `401 CONSUMER_KEY_UNAUTHORIZED`; `403 INSUFFICIENT_SCOPE`, `CONSUMER_PRINCIPAL_REVOKED`, `CONSUMER_ENVIRONMENT_NOT_AUTHORIZED`, `ONBOARDING_BROWSER_ORIGIN_FORBIDDEN`; `404 CONSUMER_RESOURCE_NOT_FOUND`; `409 ONBOARDING_IDEMPOTENCY_CONFLICT`, `ONBOARDING_CONCURRENT_CONFLICT`, `ISSUER_LEGAL_IDENTITY_IMMUTABLE`, `ISSUER_PENDING_OPERATIONS`, `CONSUMER_ASSOCIATION_PENDING_OPERATIONS`; `422` por certificado o emisor destino no apto; `503 ONBOARDING_SECRET_CLEANUP_FAILED` o falla de almacenamiento. No registrar cuerpos, archivos, PIN, claves ni contraseñas en Afiliaciones. Usar un identificador de correlación propio en su backend para trazabilidad.

## Brechas para integración directa

- El módulo de laboratorio no está activado en `AppModule`. La integración productiva requiere una decisión de registro de rutas, despliegue, custodia de la clave HMAC y operación de la cola de recuperación. No se activó.
- El comando local solo acepta PostgreSQL descartable y SANDBOX. La provisión productiva requiere un proceso aprobado de operadores Billing; Afiliaciones no puede autocrear asociaciones ni claves.
- `connection-test` verifica estado almacenado, referencias y capacidades, pero no prueba autenticación con Hacienda ni autorización productiva. No debe presentarse como validación de credenciales.
- `RECOVERY_REQUIRED` y `COMMITTED_CLEANUP_PENDING` necesitan monitoreo y ejecución operativa del endpoint de recuperación antes de registrar rutas productivas. Una referencia retirada puede permanecer cifrada hasta completar esa limpieza, aunque ya no esté activa en la tabla fiscal.
- `HaciendaTokenCache` es memoria local del proceso. La rotación invalida la instancia que atendió la petición; un despliegue con varios procesos necesita invalidación distribuida o una garantía equivalente antes del gate productivo.

## Gates (no inferir PASS por compilación)

| Gate | Estado verificado en laboratorio |
|---|---|
| BILLING_ONBOARDING_V1_REUSE | PASS técnico: mismas tablas fiscales y `SecretProvider`, contratos v1 intactos; v1 e Inventori Wave 8 HTTP 10/10 |
| BILLING_ONBOARDING_V2_CONTRACTS | PASS de laboratorio: OpenAPI actualizado y 14/14 HTTP SPEC-09 |
| BILLING_ONBOARDING_V2_SECURITY | PASS técnico de laboratorio: revalidación bajo bloqueo antes del commit; pruebas de revocación, scope, ambiente, empresa y concurrencia |
| BILLING_ISSUER_ASSOCIATION | PASS de laboratorio: sucesión transaccional v2 y bloqueo por pendientes en W1-D2 HTTP |
| BILLING_CREDENTIAL_ROTATION | PASS técnico de laboratorio: rotación, replay, concurrencia y compensación sintética HTTP |
| BILLING_CONNECTION_TEST | PASS local: checks sin Hacienda ni emisión, 3/3 HTTP SPEC-09 |
| BILLING_INITIAL_BINDING | PASS técnico de laboratorio: comando local con administrador verificado, repetición idempotente y rechazo M2M/rol revocado |
| BILLING_SECRET_ATOMICITY | PASS técnico de laboratorio: fallo de proveedor, PIN, auditoría y clave revocada no activan secreto parcial; recuperación durable |
| BILLING_AUDIT_INTEGRITY | PASS técnico de laboratorio: registro de operación y evento de activación en la misma transacción; fallo inyectado revierte escritura |
| INVENTORI_V1_COMPATIBILITY | PASS de laboratorio: contratos v1 intactos y Wave 8 con cliente Inventori 10/10 HTTP |
| BILLING_SPEC09_TECHNICAL_PASS | PASS técnico de laboratorio tras pruebas HTTP y regresión; sin permiso de producción |
| PRODUCTION_READINESS | NO APROBADO; rutas v2 desactivadas |

## Evidencia ejecutada

- Al reproducir desde este worktree, ejecutar primero `npm run db:generate` para generar el cliente Prisma con `FiscalOnboardingMutationV2`; el `node_modules` local puede estar compartido con otra copia de Billing.
- `node scripts/test-safety/disposable-postgres.mjs run -- node scripts/test-safety/run-disposable-validation.mjs e2e spec09-onboarding-v2-lab`: 14/14 HTTP reales y comando local en PostgreSQL efímero; aislamiento multiempresa, PKCS#12 sintético, PIN inválido/válido, sustitución histórica, rotación concurrente, revocación intermedia, fallos de proveedor/auditoría, recuperación concurrente y no exposición.
- Regresión HTTP `fiscal-onboarding-v1.e2e-spec.ts|fiscal-onboarding-wave8-integration.e2e-spec.ts`: 10/10, cliente Inventori local sin modificaciones.
- Regresión HTTP `w1-d2-consumer-lab.e2e-spec.ts`: 10/10, asociación, sucesión, pendientes y rotación de claves con actor administrativo vigente.
- Regresión HTTP `w2-b2-persistent-invoice.e2e-spec.ts|w3-a-corrective-lab.e2e-spec.ts`: 42/42, FE/TE y correctivas M2M v2.
- Jest focalizado en consumidor, certificados, XML y XSD: 15 suites y 172/172 pruebas. El proveedor local cifrado pasó 12/12 pruebas adicionales de persistencia, concurrencia, aislamiento de clave y no exposición en disco.
- `npm run build`, `npm run typecheck`, `npm run lint:check`, `npm run test:safety:static`, `prisma validate`, parseo de OpenAPI y `git diff --check`: aprobados en la rama aislada.
- Jest focalizado de política v2, v1, certificados, firma y XML: 172/178 en sandbox; los seis fallos eran del subproceso XSD Python bloqueado. La suite XSD 1.1 completa pasó 9/9 con acceso al subproceso local.
- La migración `20261119000000_spec09_secure_onboarding` se aplicó únicamente al PostgreSQL efímero. `FiscalOnboardingMutationV2` registra referencias y HMAC, sin bytes de certificado, PIN ni contraseñas.
