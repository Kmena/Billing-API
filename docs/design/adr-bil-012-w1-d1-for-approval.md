# ADR-BIL-012 · idempotencia y recuperación v2 — versión para aprobación

**Estado:** PENDIENTE DE APROBACIÓN. **Fuente exacta:** fila DRAFT de `billing-completion-sdd.md` §5: «Nueva reserva con namespace de consumidor/ambiente frente a cambiar índice v1; preservar lookup histórico y rotación». La reserva v1 y su índice `(tenantId,companyId,operation,key)` permanecen como historia de Inventori.

## Decisión propuesta

Crear `FiscalIdempotencyKeyV2` **separada**. Namespace único `(associationId,environment,operation,key)`; `associationId` resuelve de forma inmutable consumidor, empresa, tenant y ambiente. `apiKeyId` identifica la primera credencial para auditoría, **nunca** forma parte de la unicidad: una clave rotada encuentra la misma reserva. Otra asociación puede usar la misma cadena `Idempotency-Key` sin colisión. El ambiente almacenado debe igualar el de la asociación mediante FK/constraint revisado por DBA.

| Campo / regla | Propuesta |
|---|---|
| Reserva | `id`, `tenantId`, `associationId`, `environment`, `operation`, `key`, `requestHashVersion`, `requestHash`, `state`, `fiscalDocumentId?`, `firstApiKeyId?`, `attemptCount`, `leaseExpiresAt?`, timestamps, versión de fila. `key` opaca, máximo 128 caracteres; nunca se registra en logs. |
| Unicidad | Índice único DB del namespace completo. La aplicación usa `INSERT … ON CONFLICT DO NOTHING` y relectura bajo transacción; no se basa solo en un check previo. |
| Hash | SHA-256 de representación canónica **versionada calculada por Billing** al recibir una operación de creación. Una evidencia de hash del cliente solo se compara. El algoritmo fiscal exacto `fiscal-payload.v2`, redondeo y campos requieren ADR-BIL-013/decisiones DF de W2: W1-D1 no crea reservas fiscales reales. |
| Estados | `RESERVED` sin identidad asignada; `COMMITTED` con `fiscalDocumentId`; `RECOVERY_REQUIRED` si el resultado externo o transición quedó incierto; `ABORTED_BEFORE_ALLOCATION` solo si se probó que no existe identidad fiscal. No hay reemisión automática por timeout. |
| Concurrencia | Una transacción gana la inserción; las otras comparan hash/versión y retornan mismo resultado o conflicto. Transiciones usan bloqueo de fila o compare-and-swap/versionado; lease vencida no equivale a permiso para asignar otro consecutivo. |
| Consulta | `POST /api/v2/companies/{companyId}/fiscal-documents/{environment}/operations/lookup`, **solo lectura**, con `operation`, `idempotencyKey`, `requestHashVersion` y `requestHash` obligatorios en body, `Cache-Control: no-store`; principal vinculado a la asociación, no `consumerId` suministrado. |
| Respuestas | `200` resultado comprometido; `202` reserva/recuperación con `Retry-After`; `404` para ausente, otra asociación o hash de lookup distinto; `409 IDEMPOTENCY_PAYLOAD_CONFLICT` **en la creación** si misma clave tiene otro payload y antes de numerar; `409` en lookup solo para integridad interna detectada, sin identidad ajena. |
| Retención | Sin borrado automático ni reciclaje de clave, incluso tras `ABORTED_BEFORE_ALLOCATION`, hasta que ADR-BIL-017 y política fiscal/operativa aprueben plazo y archivo. Reservas vinculadas a documentos sobreviven a rotación/revocación. |
| Auditoría | Alta y transición de reserva en la misma transacción; registrar namespace, hash/version, asociación, primer keyId y correlationId, sin secreto ni payload. La lectura se audita sin enumerar otros consumidores. |

El lookup **no recalcula** el hash si no recibe el payload original: compara el hash obligatorio del cliente con el valor persistido por Billing. Esta propuesta corrige dos puntos del OpenAPI D0: allí el hash de lookup es opcional y el caso sintético de hash distinto espera `409`; tras aprobación deben pasar a hash obligatorio y `404` para evitar enumeración, conservando `409` en replay de creación. El contrato v1 actual ya oculta un hash de lookup distinto con `404`.

## Alternativas

| Alternativa | Evaluación |
|---|---|
| Cambiar el índice/filas de `FiscalIdempotencyKey` v1 | Reabre la reconciliación histórica A/B y puede cambiar replay de Inventori; rechazada. |
| Namespace por `apiKeyId` | La rotación permitiría dos reservas para la misma operación; rechazada. |
| Namespace solo por empresa | Dos consumidores de la misma empresa colisionan; rechazada. |
| GET lookup con clave en query | URL, logs y cachés pueden conservar el identificador; se recomienda POST de lectura con `no-store`. |
| TTL y borrado automático | Permite reutilizar una clave antigua y arriesga identidad fiscal duplicada; queda fuera hasta política aprobada. |

## DDL, dependencias y aceptación

**DDL requerido:** nueva tabla, FKs/único/índices de recuperación, restricciones de estado-documento y compatibilidad tenant/ambiente. No cambiar `fiscal_idempotency_keys` v1, su índice ni `api_key_id` histórico. Si W1-D1 no emite documentos, las columnas de origen de `FiscalDocument` pueden programarse para la wave que inserte el primer documento v2, pero la migración debe diseñarse y ensayarse antes de activar emisión o lectura por origen.

**Sin DDL antes del gate DBA:** contrato revisado, máquina de estados pura, canonicalización de prueba **no fiscal**, validación de namespace, fixtures de carreras y política de lookup. No publicar una operación de creación ni persistir una reserva con `requestHashVersion='pending-v2-hash'`.

**Aceptación en DB descartable:** 100 intentos concurrentes ⇒ una fila; dos claves rotadas ⇒ misma fila/identidad; dos consumidores misma empresa ⇒ namespaces distintos; otro ambiente ⇒ separado; hash de creación distinto ⇒ 409 antes de numerar; lookup ajeno/hash distinto ⇒ 404; timeout ⇒ 202/recuperación sin duplicar; restauración ⇒ estado/hash estables. E2E Inventori fijado y hash v1 permanecen idénticos. No se puede declarar emisión W2 lista con estas pruebas.

**Aprobación requerida:** arquitectura para namespace, estados, consulta y no borrado; seguridad para evidencia obligatoria y logging; DBA para índice/FKs/retención materializada. ADR-BIL-013/DF se aprueban aparte antes de un hash fiscal v2 operativo. Hasta entonces, **PENDIENTE**.

| Registro de aprobación | Completar por responsables |
|---|---|
| Resolución | Aprobar propuesta / pedir cambios / rechazar |
| Arquitectura y seguridad | Responsable, fecha, hash obligatorio y semántica 404/409 confirmados |
| DBA | Visto bueno al modelo lógico y retención sin purga; SQL/ventana se autorizan aparte |
| Dependencia fiscal | ADR-BIL-013/DF pendientes o aprobados con referencia, sin inferencia |

## Decisión operativa W0–W3, 2026-10-28

El operador ratificó para el laboratorio reserva persistente por asociación/ambiente, hash fiscal versionado, protección concurrente, recuperación, conflicto de contenido y lookup seguro. El consumidor queda implícito en la asociación, conforme al namespace de este ADR; no se añade `consumerId` al índice. DP-01 bloquea sucesión mientras haya reservas `RESERVED`/`RECOVERY_REQUIRED` o documentos v2 sin estado terminal. Las reservas históricas conservan su asociación y no se migran ni se recrean. El mecanismo v1 no cambia. La aprobación formal de retención, seguridad y DBA sigue pendiente.
