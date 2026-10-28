# ADR-BIL-011 · identidad y asociación multi-consumidor — versión para aprobación

**Estado:** PENDIENTE DE APROBACIÓN. **Fuente exacta:** fila DRAFT de `billing-completion-sdd.md` §5: «Asociación plural separada de `FiscalIntegrationAssociation` v1; evaluar migrarla en sitio solo si se prueba equivalencia histórica. ConsumerId estable, derivado de credencial». Este archivo desarrolla la decisión; no constituye aprobación ni activa `/api/v2`.

## Decisión propuesta

Adoptar **identidad de consumidor y asociación v2 separadas de v1**. `consumerId` es un UUID interno, estable por `(tenantId, provider, externalConsumerKey)`, que el servidor obtiene por la clave autenticada y su binding; no se calcula a partir del secreto ni cambia al rotarlo. Una empresa legal puede ser usada por Inventori v1 y por varios consumidores v2 sin compartir claves, permisos, reservas ni documentos. Billing guarda solo referencias del consumidor; planes, saldos, pagos y asignaciones permanecen en el sistema comercial.

La propuesta refina el diseño W1 anterior con un mapeo de emisor independiente del ambiente:

| Entidad | Identidad, restricción y autoridad |
|---|---|
| `FiscalConsumer` | `id`, `tenantId`, `provider`, `externalConsumerKey`, `status`; único `(tenantId,provider,externalConsumerKey)`. Provider pertenece a catálogo administrado; ID no se recicla. |
| `FiscalConsumerCompany` | `id`, `tenantId`, `consumerId`, `companyId`, `externalCompanyKey`, `status`; únicos `(tenantId,consumerId,companyId)` y `(tenantId,consumerId,externalCompanyKey)`. El mismo identificador externo no puede mapear otra `Company` al cambiar de ambiente. |
| `FiscalConsumerAssociation` | `id`, `tenantId`, `consumerCompanyId`, `environment`, `status`; único `(consumerCompanyId,environment)`. SANDBOX y PRODUCTION tienen asociaciones y claves distintas; ambas resuelven la misma empresa legal del mapeo. |
| `FiscalConsumerKeyBinding` | `apiKeyId` único, `tenantId`, `associationId`, `createdAt`. Binding inmutable. `ApiKey.status/revokedAt` es la autoridad de revocación; no se duplica el estado en binding. |

El DBA define FKs/índices compuestos que impidan asociación cruzada de tenant y mapeo de empresa ajena. La equivalencia `ApiKey.TEST → SANDBOX` y `LIVE → PRODUCTION` se verifica al emitir la clave y en **cada** request v2. Un `FiscalConsumer` o asociación suspendida invalida inmediatamente la autoridad de todas sus claves. No se hace backfill supuesto de Inventori ni se modifica `FiscalIntegrationAssociation.companyId @unique`.

### Credenciales, scopes y auditoría

- Reutilizar formato, generación aleatoria y hash Argon2id de `ApiKey`, con secreto mostrado una vez, expiración obligatoria, rotación que conserva `consumerId`/asociación y revocación inmediata. El perfil recomendado es **`billing-consumer-v2`** más el binding y catálogo por proveedor. Sustituye, si se aprueba, el nombre provisional `affiliations-fiscal-v1` del diseño D0; no cambia `inventori-fiscal-v1` ni sus claves.
- Scopes W1 de mínimo privilegio: `fiscal-v2:readiness:read` y `fiscal-v2:operations:read`. Reservar los scopes de emisión/artefactos para waves posteriores. Es un cambio propuesto respecto del OpenAPI D0 y exige actualizarlo junto con fixtures/contratos antes de activar rutas.
- La creación v2 no reutiliza sin adaptación `CreateApiKeyHandler`: hoy un `integrationProfile` reemplaza los scopes solicitados por el catálogo completo del perfil. Una ruta v2 separada debe validar subconjunto explícito y hacer commit atómico de `ApiKey`, binding y auditoría antes de devolver el secreto.
- No insertar `ApiKeyCompany` para claves v2. El guard v2 usa únicamente binding. `AssignApiKeyCompanyHandler` debe rechazar el perfil v2 y el guard de rutas `/api/v1` debe rechazar explícitamente ese perfil. Esto protege rutas v1 sin `IntegrationProfileGuard` y sin `companyId` en la URL. Las claves y autorizaciones v1 existentes conservan su comportamiento.
- La administración exige JWT `TENANT_ADMIN`; una clave M2M no crea otras claves ni cambia Hacienda, certificado o secuencias. Cada mutación de consumidor/asociación/clave escribe auditoría en la **misma transacción** que la mutación; `AuditService.record()` actual es asíncrono y no basta para estas acciones críticas. Eventos de denegación y consulta registran actor/tenant/consumer/association/keyId/correlationId sin secreto, payload fiscal ni identificación completa.
- Rotación: clave nueva independiente con expiración, ventana máxima de solapamiento **propuesta de 24 horas**, revocación explícita de la vieja y pruebas de ambas. Seguridad debe aprobar duración de vida de clave y este máximo antes de emitir una clave real. La revocación no borra binding ni historia.

## Alternativas rechazadas para aprobación

| Alternativa | Motivo |
|---|---|
| Rehacer `FiscalIntegrationAssociation` v1 para varias filas por `companyId` | Puede cambiar el lookup, bootstrap y unicidad histórica de Inventori; no hay equivalencia probada. |
| Una sola clave N:M para varios emisores | Una filtración concede acceso a varias empresas y hace ambiguo el origen y la revocación. |
| Asociación con `externalCompanyKey` único solo por ambiente, como el diseño W1 inicial | Permite que el mismo emisor externo se remapee silenciosamente a otra empresa en PRODUCTION. El mapeo independiente impide esa divergencia. |
| Reutilizar scopes v1 `invoices:read` o el perfil completo Inventori | Rutas v1 de factura no exigen siempre `IntegrationProfileGuard`; una clave nueva podría alcanzar datos históricos. |

## Compatibilidad, DDL y aceptación

**Inventori:** sus 42 pares verbo/ruta, `inventori-fiscal-v1`, scopes, `ApiKeyCompany`, asociación e idempotencia v1 permanecen. Una clave v2 debe recibir 403 en `/api/v1`; una clave v1 debe recibir 403 en `/api/v2`. Repetir lock de 42 rutas, 153 E2E del cliente fijado y negativos cruzados tras cada cambio de guard.

**DDL aditivo requerido:** cuatro tablas nuevas y FKs/índices de soporte; no cambio de columnas de `api_keys` ni de `fiscal_integration_associations`. La forma exacta de FK compuesta, índices y costo de locks requiere preflight y visto bueno DBA. **Sin DDL:** catálogo/scopes propuestos, DTO, políticas puras, guard y tests aislados; no activar alta operativa ni asociar un emisor real antes de los gates.

**Pruebas de aceptación:** dos consumidores en una empresa y en empresas distintas, ambos ambientes, remapeo externo 409, dos keys rotadas en una asociación, clave revocada/expirada, suspensión, tenant y empresa cruzados, `ApiKeyCompany` no asignable a perfil v2, secreto retornado una vez y auditoría transaccional. Usar PostgreSQL descartable y datos sintéticos. El piloto real requiere DP-01.

**Aprobación requerida:** arquitectura e integraciones para modelo/perfil/scopes; seguridad para vida de clave, solapamiento y auditoría; DBA para DDL. Registrar nombres, fecha y versión aprobada. Hasta entonces, **PENDIENTE**.

| Registro de aprobación | Completar por responsables |
|---|---|
| Resolución | Aprobar propuesta / pedir cambios / rechazar |
| Arquitectura e integraciones | Responsable, fecha y versión |
| Seguridad | Vida máxima de clave aprobada, solapamiento aprobado y responsable |
| DBA | Visto bueno al modelo lógico; SQL/ventana se autorizan aparte |

## Decisión operativa W0–W3, 2026-10-28

El operador adoptó los criterios de identidad independiente, claves separadas, scopes mínimos, asociación explícita por empresa/ambiente y auditoría para esta implementación aislada. La compatibilidad v1 se conserva. **Discrepancia DP-01:** la petición de asociación modificable no puede ejecutarse como cambio en sitio de `FiscalConsumerCompany.companyId`: esta propuesta y sus índices prohíben remapear el mismo `externalCompanyKey`. El laboratorio implementa sucesión explícita con una clave externa nueva, suspende la asociación anterior y deja intacto el origen histórico. Si negocio exige conservar la clave externa al cambiar de emisor, arquitectura/DBA deben aprobar otro modelo y DDL; no se infiere esa aprobación. El estado formal del ADR sigue pendiente de firmas de arquitectura, seguridad y DBA.
