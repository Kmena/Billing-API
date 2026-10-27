# Billing W1-D1 · decisiones listas para aprobación y plan de implementación

**Estado:** PROPUESTA FINAL PARA APROBACIÓN, NO IMPLEMENTADA. **Base:** `codex/billing-w1-design` / `d132fc5`, W0_TECHNICAL_PASS y W1_D0_TECHNICAL_PASS. Las únicas fuentes vigentes para ADR-BIL-011, ADR-BIL-012 y DP-01 son sus filas DRAFT/PENDING del [SDD maestro](../../billing-completion-sdd.md); las actas siguientes las desarrollan sin convertirlas en aprobadas: [ADR-BIL-011](adr-bil-011-w1-d1-for-approval.md), [ADR-BIL-012](adr-bil-012-w1-d1-for-approval.md), [DP-01](dp-01-w1-d1-for-approval.md).

**Decisión previa aprobada:** ADR-010 de Fase 0 mantiene Billing e Inventori como servicios independientes, sin BD, imports ni autenticación compartidos. Este diseño aplica el mismo límite al consumidor nuevo. ADR-BIL-011/012 y DP-01 continúan **pendientes**; tampoco se toman decisiones tributarias de W2.

## Tabla de decisiones para el operador

| Decisión | Alternativas | Recomendación | Impacto sobre Inventori | Impacto sobre nuevo consumidor | DDL | Riesgos | Aprobación requerida |
|---|---|---|---|---|---|---|---|
| ADR-BIL-011: identidad | Alterar asociación v1; asociación v2 separada; clave N:M compartida | `FiscalConsumer` + mapeo de empresa global + asociación por ambiente + binding unívoco de clave | Mantener `FiscalIntegrationAssociation`, claves y 42 rutas v1; rechazar **solo** perfil nuevo en v1 | `consumerId` estable tras rotación, una clave por empresa/ambiente, proveedor independiente | Sí: cuatro tablas/FKs/únicos | Remapeo externo, tenant cruzado, acceso v2 a rutas v1 | Arquitectura, integraciones, seguridad; DBA para forma física |
| ADR-BIL-011: perfil/scopes/revocación | Reusar perfil Inventori; perfil de afiliaciones; perfil v2 genérico con binding | `billing-consumer-v2`, scopes `fiscal-v2:readiness:read` y `fiscal-v2:operations:read`, expiración y revocación de `ApiKey` como autoridad | Sin cambio de scopes o secretos v1; `ApiKeyCompany` no acepta perfil v2 | Secreto una vez; rotación conserva asociación; ninguna clave ordinaria administra Hacienda | Binding sí; catálogo/guards no | Creador actual autoasigna perfil completo; auditoría asíncrona; solapamiento de keys | Arquitectura y seguridad; vida máxima de clave/solapamiento a fijar |
| ADR-BIL-012: namespace | Modificar índice v1; usar apiKeyId; usar empresa; tabla v2 | Tabla v2 única por asociación+ambiente+operación+clave; keyId solo auditoría | Índice, filas, hash y lookup históricos intactos | Dos consumidores misma empresa no colisionan; rotación no duplica | Sí: tabla/único/FKs | Carrera de reserva, historia A/B, divergencia de esquema | Arquitectura + DBA |
| ADR-BIL-012: consulta, estado y retención | GET query; POST con hash opcional; POST con hash obligatorio | POST de solo lectura, hash/version obligatorios, 404 en mismatch de lookup; 409 en creación conflictiva; sin purga/reuso hasta política aprobada | Mismo comportamiento de lookup v1; ninguna reinterpretación de estado fiscal | Recuperación 202/Retry-After sin renumerar; estado durable | Estado/lease en tabla v2; contrato y política sin DDL | Enumeración, timeout, crecimiento de tabla, hash fiscal W2 aún pendiente | Arquitectura y seguridad; DBA para índices, fiscal/operación para retención final |
| DP-01: primer emisor | Misma `Company`; otra `Company`; ningún piloto real | Compartir solo con prueba de mismo obligado legal/tenant; separar si distinto; si no hay evidencia, usar solo sintéticos | Ninguna reasignación de emisor/clave/secuencia actual | Requiere identidad legal, `externalCompanyKey`, ambiente y dueño explícitos | Sin DDL adicional a ADR-011 | Unificar emisores distintos o duplicar un mismo emisor por inferencia | Dueño del emisor/negocio, fiscal, integración, seguridad/operación |

Todas estas recomendaciones siguen **sin aprobar**. El perfil genérico, los scopes con prefijo y el hash obligatorio de lookup **refinan** los OpenAPI/fixtures propuestos en D0; no deben implementarse contra la versión D0 sin actualizar contrato, ejemplo y prueba juntos tras aprobación.

## Incompatibilidades comprobadas con el código actual

| Evidencia actual | Consecuencia para D1 |
|---|---|
| `FiscalIntegrationAssociation.companyId @unique` | No soporta segundo consumidor de la misma empresa; preservar tabla v1 y añadir modelos separados. |
| `ApiKeyCompany` N:M y `AssignApiKeyCompanyHandler` acepta cualquier clave activa del tenant | Una futura clave v2 podría recibir otra empresa por el endpoint administrativo v1; bloquear perfil v2 allí y autorizar v2 solo con binding. |
| `CreateApiKeyHandler` ignora `command.scopes` si hay `integrationProfile` y asigna todo `scopesForIntegrationProfile()` | La ruta v2 necesita creador separado o refactor con prueba v1; nunca confiar en scopes enviados sin catálogo cerrado. |
| `ALLOWED_API_KEY_SCOPES` no contiene `fiscal-v2:*`; `fiscal-readiness:read` e `invoices:read` ya se usan en v1 | Añadir scopes v2 de forma controlada solo al activar su guard; no conceder scopes heredados para “hacer pasar” una prueba. |
| `ApiKeyAuthGuard` autentica claves sin perfil v2 y algunas rutas de documento v1 no tienen `IntegrationProfileGuard` ni `companyId` | El guard v1 debe rechazar explícitamente perfil v2; el guard v2 debe rechazar v1, sin variar la autorización de claves existentes. |
| `FiscalIdempotencyKey` es única por tenant/empresa/operación/key; `FiscalDocument` no tiene origen | Namespace compartido y lectura por ID no sirven para v2. Tabla nueva para reserva; columnas de origen antes de primer documento v2, nunca backfill supuesto. |
| `AuditService.record()` es fire-and-forget | Mutaciones de asociación/clave/reserva requieren auditoría transaccional; errores/consultas pueden usar registro técnico sin secreto. |
| OpenAPI D0 admite hash opcional y fixture espera 409 en lookup con hash distinto | ADR-012 recomienda evidencia obligatoria y 404 para lookup mismatch; actualizar OpenAPI/fixtures antes de activar endpoint. |
| W0 observó diff Prisma en 16 tablas; D0 no tuvo conexión a base objetivo | No derivar DDL de `prisma migrate diff` automáticamente ni afirmar estado actual de A/B. Preflight DBA en lectura antes de nueva migración. |

## Separación de trabajo por esquema y gates

| Gate | Trabajo ejecutable después de aprobaciones | DDL / datos reales | Criterio de salida |
|---|---|---|---|
| D1-A · antes de revisión DBA | Ajustar OpenAPI/fixtures aprobados; DTO y policy de principal v2 sobre repositorios falsos; test de rechazo de perfil cruzado y lock de 42 rutas; modelo de estados puro y vectores no fiscales | Ninguno. No registrar alta v2 operativa ni aceptar reservas | Negativos 401/403/404, rotación, scopes mínimos, contrato v1/E2E intactos. |
| D1-B · preflight DBA | Ejecutar [consultas D0 de solo lectura](../operations/billing-w1-d0-dba-readonly.sql) **solo con acceso autorizado**, clasificar 16 tablas, A/B, checksums, FKs e índices; revisar plan expand/rollback | Lectura de metadatos de base objetivo, sin DDL/DML | Informe DBA firmado sobre diferencias reales y SQL aditivo propuesto. |
| D1-C · ensayo de esquema | Añadir Prisma/modelos y migración expand de consumidor/mapeo/asociación/binding/reserva; comprobar FKs, únicos y locks en restore descartable | DDL **solo descartable** tras ADR y revisión DBA | 24 checksums históricos, diffs clasificados, reversión de binario sin pérdida, claves v1 intactas. |
| D1-D · integración técnica | Alta/rotación/revocación administrativa transaccional, guard v2, readiness y lookup sin emitir; pruebas multiempresa, carreras, auditoría y E2E con sintéticos | Solo DB descartable hasta autorización adicional | Dos consumidores misma empresa, dos empresas y ambientes; 100 carreras/una reserva; cero clave fiscal nueva; regresión completa. |
| Gate de emisor real | Alta de asociación/clave del piloto y cualquier DDL en base objetivo | **Fuera de esta preparación** | DP-01 completada, seguridad/DBA/operación y ventana aprobadas por separado. |

La parte D1-A puede implementarse **antes de completar la revisión DBA** una vez aprobadas ADR-BIL-011/012 y autorizada una tarea futura de implementación. El código que registra rutas operativas, guarda claves/asociaciones, usa reservas o ejecuta DDL depende del gate DBA y, para datos reales, también de DP-01. El diseño genérico puede probar ambas topologías sintéticas aunque DP-01 siga pendiente; no activa ninguna empresa real.

## Tareas para agentes de implementación (no despachadas)

| ID | Dependencia | Tarea y pruebas | Aceptación |
|---|---|---|---|
| D1-01 / T03 | ADR-011 aprobado | Actualizar OpenAPI y fixtures, catálogo de scopes v2, política de perfil cruzado, DTO sin rutas activas | 42 pares v1/snapshot intactos; tests de perfil v1↔v2 y permisos mínimos. |
| D1-02 / T03 | D1-01 + gate DBA para migrar | Modelos aditivos, restricciones tenant/empresa/ambiente, servicio de alta repetible y conflicto 409 | Dos consumidores misma empresa/empresas distintas, ambiente separado, remapeo bloqueado, solo DB descartable. |
| D1-03 / T03/T05 | D1-02 | Emisión/rotación/revocación de key v2 con secreto una vez, expiración y auditoría transaccional | Una key/association, revocación inmediata; no se puede asignar a otra empresa; sin acceso a v1. |
| D1-04 / T04 | ADR-012 + D1-02 + gate DBA | Tabla/estado de reserva, inserción única, lookup con hash obligatorio y recuperación; **sin creación fiscal** | 100 carreras, rotación, conflicto y timeout sobre DB descartable; reservas W1 sintéticas no expuestas en base real. |
| D1-05 / T05 | D1-03/D1-04 | Guard v2 y filtros de origen para superficies habilitadas; readiness seguro | Negativos tenant×empresa×ambiente×consumidor×clave×scope; 404 uniforme; v1 cliente fijado 153/153. |
| D1-06 / gate | D1-01–05 | Unidad, contratos, safety, E2E descartable, hash v1, build/lint; evidencia técnica | Sin fallas, delta de 16 tablas resuelto o documentado, ninguna emisión v2, sin STAG/PROD. |

El hash fiscal de una creación v2, las líneas y FE/TE requieren ADR-BIL-013/DF y W2; D1-04 solo entrega infraestructura de reserva/consulta probada con datos sintéticos. Los filtros de documentos/artefactos v2 se preparan en T05 y se verifican E2E cuando esas superficies se activen. Una aceptación FE histórica no valida otros tipos.

## Autorizaciones concretas para comenzar

1. Arquitectura e integraciones aprueban **ADR-BIL-011**: cuatro entidades, mapping externo estable, perfil/scopes v2, separación de `ApiKeyCompany` y bloqueo cruzado v1/v2.
2. Arquitectura y seguridad aprueban **ADR-BIL-012**: namespace, estado, hash obligatorio de lookup, 404 de mismatch, no purga/reuso hasta política posterior; DBA revisa estructura e índices. ADR-BIL-013/DF quedan explícitamente pendientes para emisión.
3. Seguridad fija vida máxima de clave, ventana de rotación propuesta de 24 horas, custodia del secreto y auditoría transaccional antes de emitir una credencial real.
4. Para D1-A basta una **nueva instrucción de implementación** que cite las actas aprobadas; no requiere aún acceso DBA ni DP-01. Para D1-C/D1-D se requiere informe DBA de lectura, aprobación de migración aditiva y autorización de uso de DB descartable. Para vincular el primer emisor real, además se completa y aprueba **DP-01** con tenant, `Company`, ambiente, identidad legal y responsables, más autorización operativa separada.

No se ejecutó W1-D1, migración, alta real, merge ni despliegue al preparar este documento.
