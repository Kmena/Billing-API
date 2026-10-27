# Billing W1 — diseño técnico de identidad multi-consumidor

**Estado:** PROPUESTO, sin autorización de implementación. **Base:** `codex/billing-w0` / `e1294de`, W0_TECHNICAL_PASS local. **Alcance W1:** identidad, vinculación, credenciales, aislamiento e idempotencia v2. La emisión fiscal de líneas v2 pertenece a W2 y se documenta aquí solo para fijar el límite de integración. No se ejecutó W1, DDL, STAG ni despliegue.

Fuentes: `billing-completion-sdd.md` §§3, 5, 6 y 8; `billing-affiliations-integration.md`; [evidencia W0](../operations/billing-w0-technical-evidence.md); [inventario Inventori v1](../contracts/inventori-v1-inventory-w0.md); [reconciliación Prisma](../operations/billing-w0-schema-reconciliation.md). Los ADR-BIL-011/012 y DP-01 **no tienen actas aprobadas independientes en este checkout**: su texto exacto es la fila DRAFT/pendiente del SDD. El ADR-010 sí figura aprobado en `specs/fase-0-foundation/decisions.md` del checkout original; `specs/` está ignorado y no se incorporó a esta rama.

W0 aportó 1.297 pruebas unitarias aprobadas/13 omitidas por infraestructura en la rama limpia; las 13 se ejecutaron y aprobaron por separado en PostgreSQL/LocalStack descartables. También aportó E2E 153/153 con cliente Inventori fijado, 24 migraciones y checksums en DB descartable, cero pendientes allí y 16 tablas con divergencia Prisma. La base normal no fue consultada. Esta evidencia protege el punto de partida, no acredita W1 ni STAG.

## 1. Decisiones y alcance de autoridad

| Identificador | Estado comprobado | Texto/propuesta de la fuente | Decisión todavía necesaria |
|---|---|---|---|
| ADR-010 | APROBADO en especificación Fase 0 | Billing e Inventori independientes; sin BD, imports ni autenticación compartidos; solo IDs/referencias, API y eventos | Aplicar el mismo límite al sistema de afiliaciones. |
| ADR-BIL-011 | DRAFT en SDD | Asociación plural separada de `FiscalIntegrationAssociation` v1; migrarla en sitio solo si se prueba equivalencia histórica; `consumerId` estable derivado de credencial | Aprobar modelo separado, claves de unicidad, regla de legacy y titularidad de administración. |
| ADR-BIL-012 | DRAFT en SDD | Reserva nueva con namespace consumidor/ambiente preferida frente a cambiar índice v1; preservar lookup histórico y rotación | Aprobar tabla v2, hash/canonización, estados de reserva y política de recuperación. |
| DP-01 | PENDIENTE en SDD | Determinar primer emisor y si Inventori y afiliaciones comparten una `Company` legal; diseño debe admitir ambas topologías | Identificar tenant/emisor/ambiente piloto y quién puede vincularlo. Sin esto no se activa una asociación real. |
| ADR-BIL-013, DP-02 y DF-01–DF-06 | DRAFT/PENDIENTES | Contrato fiscal de líneas y decisiones por emisor/concepto | Bloquean emisión de líneas v2, no el diseño de identidad. |

Este documento elige una **opción recomendada para revisión**, no convierte propuestas en decisiones aprobadas. `provider` identifica la aplicación (p. ej. `AFFILIATIONS`); `consumerId` es el UUID interno estable para un tenant y una aplicación. Puede haber varios emisores asociados al mismo consumidor, pero cada **clave operativa** v2 queda ligada a una sola asociación, empresa y ambiente. No se acepta un `consumerId` enviado por el caller como autoridad.

El contenido fuente de ADR-BIL-011/012 y DP-01 se limita a las filas del SDD: ADR-BIL-011 propone asociación plural separada y `consumerId` estable; ADR-BIL-012 propone reserva nueva por consumidor/ambiente y preservación del lookup histórico; DP-01 pregunta por primer emisor y `Company` legal compartida o separada. Ninguna fila contiene aprobación, algoritmo final de hash, política de rotación ni identificación del emisor piloto. `externalConsumerKey`, el modelo de ambiente por asociación y el `POST` de lookup son precisiones **de este diseño** sometidas a aprobación, no hechos ya decididos.

## 2. Arquitectura y límites de datos

```mermaid
flowchart LR
  INV[Inventori v1] --> V1[/api/v1 inalterado]
  AFF[Afiliaciones: ledger y FiscalIntent] --> V2[/api/v2 propuesto]
  V2 --> AUTH[Clave v2 + binding + scope]
  AUTH --> ASSOC[Consumer / asociación / Company]
  ASSOC --> IDEM[Reserva v2 aislada]
  IDEM --> DOC[Documento fiscal con originConsumerId]
  V1 --> LEGACY[Asociación y reserva v1 históricas]
  DOC --> HAC[Pipeline fiscal existente, solo cuando W2 lo habilite]
```

Billing conserva emisor, clave/consecutivo, snapshot, XML, firma, envío, respuesta oficial, artefactos y entrega. Afiliaciones conserva plan, afiliación, obligaciones, períodos, saldo, pago, asignación, anticipo, reverso comercial y la decisión de solicitar un hecho fiscal. Billing recibe referencias opacas y el payload fiscal aprobado; no consulta la BD del consumidor ni calcula deuda desde `lines Json`.

### Modelos propuestos para ADR-BIL-011/012

| Modelo aditivo | Campos/índices mínimos | Invariante |
|---|---|---|
| `FiscalConsumer` | `id`, `tenantId`, `provider`, `externalConsumerKey`, `status`, auditoría; único `(tenantId, provider, externalConsumerKey)` | Identidad estable; nunca se recicla tras rotación o desactivación. |
| `FiscalConsumerAssociation` | `id`, `tenantId`, `consumerId`, `companyId`, `environment`, `externalCompanyKey`, `status`; únicos `(tenantId,consumerId,companyId,environment)` y `(tenantId,consumerId,externalCompanyKey,environment)` | Misma `Company` puede pertenecer a Inventori v1 y afiliaciones v2; cambio de mapeo externo da conflicto; desactivar no borra historia. Una asociación se limita a un ambiente. |
| `FiscalConsumerKeyBinding` | `apiKeyId` único, `associationId`, `createdAt`, `revokedAt` | Una clave v2 no se vincula a dos empresas/consumidores. `ApiKeyCompany` v1 N:M permanece; el guard v2 usa este binding como autoridad. |
| `FiscalIdempotencyKeyV2` | `id`, `associationId`, `environment`, `operation`, `key`, `requestHashVersion`, `requestHash`, `state`, `fiscalDocumentId?`, `firstApiKeyId`, timestamps; único `(associationId,environment,operation,key)` | `associationId` inmutable representa `tenant/company/consumer`; `apiKeyId` es auditoría, fuera de unicidad. |
| `FiscalDocument` | `originConsumerId?` y `originAssociationId?` aditivos; índice por `tenantId/companyId/environment/originConsumerId` | `NULL` conserva v1 histórico. Todo documento v2 nuevo debe tener origen no nulo; no se hace backfill por conjetura. |

El DDL debe imponer pertenencia del mismo tenant entre consumidor, empresa, clave y asociación mediante FKs compuestas/índices de soporte o una restricción equivalente revisada por DBA; una comprobación solo de aplicación no basta. Una asociación existente se reactiva, no se recrea con otro ID. No se cambia la unicidad v1 de `FiscalIntegrationAssociation.companyId` ni la de `FiscalIdempotencyKey`.

## 3. Autenticación M2M y autorización

1. Un JWT `TENANT_ADMIN` del tenant crea consumidor/asociación y solicita una clave. Una eventual delegación a operador fiscal requiere aprobación de seguridad; la clave de cobros nunca administra claves, Hacienda, certificado o secuencias.
2. Billing genera secreto aleatorio, almacena su hash con el mecanismo de API keys vigente y lo muestra **una vez** al backend del consumidor. La clave tiene perfil `affiliations-fiscal-v1`, ambiente `TEST` o `LIVE`, expiración y scopes de catálogo cerrado. Se guarda un binding inmutable a la asociación. El browser no recibe el secreto.
3. Cada request v2 valida en orden: secreto/estado/expiración; perfil v2; binding único; tenant y asociación activos; empresa solicitada; ambiente `TEST→SANDBOX` o `LIVE→PRODUCTION`; scope; y, para lectura por ID, `originConsumerId`/`originAssociationId`. Inactividad o revocación prevalecen sobre cachés.
4. Rotación permite solapamiento temporal de dos claves para **la misma** asociación y ambiente. Ambas ven el mismo namespace idempotente; revocar la anterior impide nuevas llamadas sin borrar reservas, documentos o auditoría. No se autoriza mover una clave rotada a otra empresa.
5. El perfil mínimo propuesto para lectura/creación futura separa `fiscal-readiness:read`, `invoices:create`, `invoices:read`, `fiscal-documents:read` y `fiscal-artifacts:read`. `tickets:create`, reenvío y reconciliación son opt-in por caso aprobado. W1 solo necesita readiness y consulta de operación; los scopes de emisión se publican cuando W2 habilite el tipo.
6. En rutas por ID sin `companyId`, el servicio carga primero identidad fiscal con filtro tenant+empresa+ambiente+origen, luego artefacto/submission/delivery. La ausencia o pertenencia ajena devuelve 404 sin revelar existencia. El v1 histórico (`originConsumerId=NULL`) conserva sus permisos actuales; un documento v2 de afiliaciones no se expone por una ruta v1 de Inventori.

`profileVersion=fiscal-consumer-v2` en el alta identifica el **contrato de asociación**; `integrationProfile=affiliations-fiscal-v1` en la clave identifica el **perfil de permisos** propuesto para esa aplicación. Sus nombres y valores necesitan ADR-BIL-011; no se cambian los perfiles v1 actuales. Las rutas de documento/artefacto v2 que aún no existen se protegen con tests de política sobre datos sintéticos en W1 y se verifican E2E al activarlas en waves posteriores.

La API actual usa `app.setGlobalPrefix('api/v1')`. Antes de montar v2 se exige un experimento de enrutamiento con prueba de las 42 rutas v1 y nuevos paths v2; no se asume que activar versionado Nest deje intacta la URL v1 automáticamente.

## 4. Contrato v2, estados e idempotencia

El [OpenAPI M2M propuesto](../contracts/billing-consumers.v2.proposed.openapi.yaml) contiene alta/lectura de consumidor y asociación, creación/revocación de clave, readiness seguro y lookup de operación. Todos los paths son **borrador** bajo `/api/v2`; ninguno existe hoy. Administración usa JWT y M2M usa `X-API-Key`. El lookup se propone como **POST de solo lectura** con clave/hash en body y `Cache-Control: no-store`, refinando el GET con query del SDD para evitar exponer la clave idempotente en URLs y logs. Esta elección forma parte de ADR-BIL-012 pendiente.

| Caso | Respuesta propuesta | Efecto |
|---|---|---|
| Primera asociación equivalente | `201`, ID estable | Alta auditada. |
| Retry exacto de asociación | `200`, mismo ID | Sin segunda empresa ni clave. |
| Mismo `externalCompanyKey` hacia otra empresa | `409 CONSUMER_ASSOCIATION_CONFLICT` | Ningún remapeo implícito. |
| Nueva reserva fiscal (W2) | `201` al crear documento local; estado fiscal separado | No equivale a aceptación Hacienda. |
| Replay misma clave/operación/hash | `200` misma identidad; `202` si aún hay operación en curso | Nunca asigna otro consecutivo. |
| Igual clave/operación y payload distinto | `409 IDEMPOTENCY_PAYLOAD_CONFLICT` | Antes de numerar; no admite replay cruzado. |
| Lookup sin reserva | `404 FISCAL_OPERATION_NOT_FOUND` | No autoriza crear de nuevo tras timeout sin reconciliar. |
| Resultado externo incierto | `202 RECOVERY_REQUIRED` con `Retry-After` | No reenvío ciego ni nueva clave. |

La reserva v2 se hace en transacción con unicidad DB. En la solicitud de emisión, Billing calcula el hash a partir de una representación canónica versionada; el hash enviado por el cliente, si existe, es evidencia a comparar, nunca fuente de autoridad. En el lookup, Billing compara esa evidencia opcional con el hash **almacenado por el servidor**: no recalcula un payload ausente. Arrays de líneas conservan orden; cadenas decimales se normalizan sin `float`; ausencia y `null` tienen regla explícita y fixtures de varias plataformas. El namespace incluye asociación, ambiente, operación y clave; cambiar de API key no cambia el resultado. El estado de reserva no se infiere del HTTP: `RESERVED`, `COMMITTED`, `RECOVERY_REQUIRED` o `ABORTED_BEFORE_ALLOCATION`; solo este último puede cerrarse sin identidad fiscal. El algoritmo final `fiscal-payload.v2` requiere ADR-BIL-013/W2 antes de aceptar emisión.

Los errores usan `{code,message,correlationId,retryable,details?}`; `details` nunca contiene secretos, identificación completa, XML o payload fiscal. `401` cubre clave ausente/inválida/revocada/expirada; `403` perfil/scope/ambiente/asociación; `404` oculta empresa/documento ajeno; `409` conflicto de asociación o payload; `422` validación fiscal futura; `429` límite; `503` dependencia indisponible con reintento seguro. Se devuelve `X-Correlation-Id` y se registra junto con `consumerId`, `associationId`, versión, operación y resultado sin volcar secreto.

## 5. Líneas, períodos y afiliaciones: contrato preparado para W2

El [OpenAPI de intención fiscal propuesto](../contracts/billing-fiscal-intent.v2.proposed.openapi.yaml) define FE con `lines[]` ordenadas y referencias opacas `source.affiliationId/periodId/allocationId`; cada línea tiene concepto, período de servicio opcional, CABYS, unidad, cantidad, precio, descuento, tratamiento e impuestos **declarados**. Un pago con varios períodos puede producir varias líneas sin que Billing calcule cuotas, saldo o destino del pago. `source` es procedencia auditable, no un nodo XML inventado. La descripción visible y la agrupación de líneas necesitan DP-02 y regla tributaria aplicable.

El productor congela su `FiscalIntent` antes de llamar a Billing y guarda la relación `externalOperationId → fiscalDocumentId/clave`. Billing valida formato, suma exacta y coherencia del tratamiento aprobado; no deduce exención por impuesto cero, moneda, país o afiliación. `policyVersion` es una referencia a la decisión fiscal del emisor, no una norma autodeclarada por Billing. Exención, no sujeción, exoneración, varios impuestos, precio incluido, divisas, FE/TE y momento de emisión están bloqueados por DF-01–DF-06/ADR-BIL-013. W1 no implementa el endpoint de emisión v2.

## 6. Pruebas, salida y tareas ejecutables

### Trazabilidad de capacidades del SDD

| Capacidad | Estado auditado en SDD | Evidencia exigida a W1 |
|---|---|---|
| C03 | IMPLEMENTED_UNVERIFIED | Dos consumidores por emisor y emisor separado, asociación/clave únicas y vínculo estable. |
| C08 | COMPLETE_VERIFIED | Readiness restringido a asociación y ambiente; no implica aceptación fiscal. |
| C11 | PARTIAL | Negativos tenant×empresa×ambiente×consumidor y origen en accesos por ID. |
| C12 | IMPLEMENTED_UNVERIFIED | Alta, rotación, revocación y rechazo de clave v1 en v2. |
| C38 | COMPLETE_VERIFIED | Golden hash y lookup v1 intactos; reserva v2 aislada bajo rotación. |
| C45 | PARTIAL | OpenAPI, ejemplos sintéticos y contrato de errores versionados; feed durable queda en W5. |

Los otros identificadores C01–C54 conservan su estado y wave del SDD maestro; W1 no los declara completos por proximidad funcional.

| Tarea | Dependencias | Trabajo autorizable después de este diseño | Aceptación |
|---|---|---|---|
| W1-D0 | Ninguna decisión nueva | Revisar OpenAPI/fixtures, prueba de routing `/api/v1`+`/api/v2`, matriz negativa y diff DBA; solo documentación/harness | Contrato parseable, 42 rutas v1 intactas, ninguna migración. |
| W1-T03a | ADR-BIL-011 y DP-01 para primer emisor | Modelos `FiscalConsumer`/asociación/binding y API admin v2 | Dos consumidores en misma empresa y en empresas distintas; retry mismo ID, remapeo 409; clave de una empresa no ve la otra. |
| W1-T03b | T03a + revisión DBA/preflight | Migración aditiva en DB descartable, sin tocar tabla v1 | Checksums/orden, FKs tenant, rollback de aplicación, restore, cero cambio de identidad v1. |
| W1-T04 | ADR-BIL-012 + T03a | Reserva v2 y lookup sin emisión fiscal | Concurrencia 100 intentos: una reserva; rotación: mismo resultado; conflicto: cero consecutivos; timeout: lookup seguro. |
| W1-T05 | T03a/T04 | Guard v2 y filtro de origen en lectura por ID/artefactos/operaciones | Matriz negativa tenant×empresa×ambiente×consumer×key status×scope; ningún documento ajeno visible; v1 E2E 153/153 y 42 rutas protegidas. |
| W1-GATE | T03–T05 | Suite completa y evidencia de DBA | Unidad/safety/E2E descartable verdes, OpenAPI/fixtures fijados, diff de 16 tablas clasificado; sin STAG ni producción. |

### Casos de prueba que debe preparar la implementación

| Prueba | Datos sintéticos y resultado esperado |
|---|---|
| Contrato | Parsear OpenAPI 3.1, validar ejemplos y respuestas, fijar snapshot de rutas/scopes v2; comparar catálogo del servidor con los 42 pares v1. Cualquier cambio v1 hace fallar la prueba. |
| Dos consumidores, mismo emisor | Inventori v1 y afiliaciones v2 en la misma `Company`; la clave v2 solo consulta su asociación, y la clave Inventori conserva su recorrido E2E. |
| Consumidores y emisores distintos | Tenant A/B, empresa A/B, SANDBOX/PRODUCTION, clave activa/revocada/expirada, asociación activa/suspendida y scopes; 401/403/404 sin filtrar existencia ajena. |
| Rotación e idempotencia | Misma asociación con dos keys ve una sola reserva; otra asociación puede reutilizar la misma cadena `Idempotency-Key`; payload distinto retorna 409; 100 intentos concurrentes no crean segunda reserva. |
| Timeout/estado | Reserva en curso retorna 202 + `Retry-After`; recuperación externa incierta no reenvía ni renumera; 201 local y 200 replay no significan aceptación oficial. |
| Esquema | Restore descartable con 24 checksums previos, FKs/únicos nuevos, origen dual nulo en históricos y completo en v2; los fingerprints de identidad/artefactos v1 no cambian. |

Los ejemplos fiscales del OpenAPI de intención son **sintéticos y deliberadamente inválidos para emisión** (`pending-*`): solo prueban estructura y separación de responsabilidades. Tras la aprobación fiscal, W2 debe reemplazarlos por fixtures oficiales validados, sin usar estos valores como defaults.

El plan de DDL y las 16 tablas se detallan en [migraciones W1](billing-w1-migration-plan.md); la [matriz v1/v2](billing-w1-compatibility-matrix.md) define los invariantes de regresión. Los tests usan datos sintéticos y PostgreSQL marcado como descartable. No se ejecuta `prisma migrate deploy` contra la base normal en W1 sin autorización operativa separada.

## 7. Riesgos y autorización pendiente

1. **Aprobar ADR-BIL-011:** modelo separado recomendado, identidad estable, unicidad y tratamiento de Inventori histórico. Cambiar la tabla v1 en sitio es alternativa de mayor riesgo y exige equivalencia de filas, permisos y rollback.
2. **Aprobar ADR-BIL-012:** tabla de reserva v2, POST lookup de solo lectura, estados y hash versionado. Cambiar el índice v1 es alternativa rechazada provisionalmente porque afecta replay/rotación histórica.
3. **Resolver DP-01:** primer tenant/emisor/ambiente, topología compartida o separada y dueño de alta. El diseño soporta ambas sin decidir por el usuario.
4. **DBA:** clasificar el diff Prisma de 16 tablas, verificar estado real de migraciones y la A histórica irrecuperable, aprobar FKs/índices aditivos y plan de restore antes de DDL.
5. **Fiscal/producto posterior:** ADR-BIL-013, DP-02 y DF aplicables antes de fijar hash y habilitar emisión de líneas v2. Una FE aceptada de Inventori no prueba cuotas, TE ni otros tipos.

**Trabajo que puede iniciarse inmediatamente si se autoriza trabajo W1:** W1-D0 (contratos, fixtures sintéticos, routing experimental, pruebas de compatibilidad y revisión DBA solo lectura). No requiere decidir topología ni impuesto. La implementación de asociación, claves, reserva y DDL espera los gates anteriores. Este documento no ejecuta esas tareas.
