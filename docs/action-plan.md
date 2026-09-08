# Architectural Action Plan — Billing Fase 0: Foundation

> **Versión:** 2.0
> **Fecha:** 2025
> **Estado:** ✅ Aprobado — Decisiones U-01 a U-10 confirmadas
> **Propietario:** hdd-architecture-agent-e257ee
> **Scope:** Fase 0 Foundation únicamente

---

## 1. Objective

Construir la base técnica de **Billing** como aplicación Node.js / TypeScript independiente de Inventori, con arquitectura hexagonal modular, multi-tenancy, seguridad desde el inicio, y una infraestructura lista para crecer hacia las Fases 1–10 sin refactors mayores.

**Al final de Fase 0, Billing debe:**
- Existir como repositorio independiente con estructura hexagonal lista
- Tener PostgreSQL con migraciones versionadas (Prisma)
- Implementar multi-tenancy row-level desde la primera migración
- Exponer los módulos Identity (Tenant + User + Auth), Companies y API Keys con sus APIs base
- Registrar auditoría completa de cada operación via AuditInterceptor
- Tener infraestructura base de queue/worker funcional (pg-boss) sin jobs de negocio reales aún
- Tener abstracción de Object Storage preparada (StoragePort) sin uso de negocio aún
- Tener abstracción de Secret Management (SecretProvider) funcional
- Tener MockHaciendaAdapter disponible (sin uso de negocio aún)
- Correr en Docker (api + worker + postgres + localstack)
- Tener CI/CD básico funcionando con gates
- Tener health checks
- Tener OpenAPI/Swagger auto-generado

**Lo que NO se construye en Fase 0:**
- Integración real con Hacienda
- Consulta de contribuyentes / CABYS / tipo de cambio
- Emisión de comprobantes fiscales
- XML, PDF, firma digital (solo el spike de investigación)
- Email / webhooks
- UI de ningún tipo

---

## 2. Scope

| Área | Incluido en Fase 0 |
|---|---|
| Scaffold del proyecto (NestJS + TypeScript strict) | ✅ |
| Estructura hexagonal (domain / application / infrastructure) | ✅ |
| Shared domain kernel (base entity, aggregate, VO, event, exception) | ✅ |
| Configuración por ambiente (ConfigModule + validación) | ✅ |
| PostgreSQL + Prisma + migración inicial | ✅ |
| Multi-tenancy row-level + TenantContext (AsyncLocalStorage) | ✅ |
| Módulo Identity: Tenant + User + roles base | ✅ |
| Auth: JWT (login + refresh) desde Fase 0 | ✅ |
| Módulo Companies | ✅ |
| Módulo API Keys (modelo completo + hashing argon2id + scopes + env separación) | ✅ |
| ApiKeyAuthGuard (autenticación via X-API-Key) | ✅ |
| Módulo Audit (append-only) | ✅ |
| AuditInterceptor (registra todas las operaciones) | ✅ |
| Correlation ID + logging estructurado (Pino) | ✅ |
| Manejo centralizado de errores (global exception filter) | ✅ |
| OpenAPI/Swagger | ✅ |
| API versionada `/api/v1` | ✅ |
| Health checks (`/health`, `/health/ready`, `/health/live`) | ✅ |
| Queue infrastructure (pg-boss + JobQueuePort) sin jobs reales | ✅ |
| StoragePort abstraction (S3 + local) sin uso de negocio | ✅ |
| SecretProvider abstraction (EnvSecretProvider + AwsParameterStoreSecretProvider) | ✅ |
| MockHaciendaAdapter + HaciendaPort (sin uso de negocio aún) | ✅ |
| Docker multi-stage + docker-compose (api + worker + postgres + localstack) | ✅ |
| CI/CD base (lint, typecheck, test, build, verify) | ✅ |
| Tests: domain unit + application unit + repository integration + E2E | ✅ |

---

## 3. Out of Scope

- Hacienda API integration real (Fase 1+)
- Taxpayers / CABYS / exchange rates (Fase 1)
- HaciendaConnection / credenciales fiscales por empresa (Fase 2)
- XML generation, XAdES signing (Fase 3 — spike se puede iniciar en paralelo)
- Async document processing pipeline (Fase 4)
- PDF generation (Fase 5)
- Email delivery (Fase 5)
- Webhooks (Fase 4)
- Received documents / purchases (Fase 6)
- Payments / receipts (Fase 7)
- UI administrativa (Fase 8)
- Billing standalone (Fase 9)
- Reportes (Fase 10)
- Rate limiting (Fase 1)
- Circuit breaker (Fase 1)
- PostgreSQL Row-Level Security (puede añadirse en Fase 1+)
- Reglas fiscales versionadas (Fase 3+)

---

## 4. Requirements Addressed

| Requisito (Billing_Plan_Desarrollo.md + decisiones U-0x) | Tarea(s) |
|---|---|
| Backend independiente de Inventori (U-10) | TASK-001 |
| NestJS + TypeScript + Hexagonal Architecture (U-01) | TASK-001, TASK-002 |
| PostgreSQL + Prisma + migraciones | TASK-004 |
| Multi-tenancy (U-02) | TASK-005 |
| Tenant, Company, User, roles base | TASK-006, TASK-007, TASK-008 |
| API Key model completo — scopes, env, revocación (U-10) | TASK-009 |
| auth/authz desde Fase 0 — JWT + API Keys (U-08) | TASK-007, TASK-009 |
| Configuración por ambiente | TASK-003 |
| Manejo centralizado de errores | TASK-011 |
| Logging estructurado (Pino) | TASK-011 |
| Correlation ID | TASK-011 |
| Audit Log append-only (U-09) | TASK-010 |
| OpenAPI / Swagger | TASK-012 |
| API versionada `/api/v1` | TASK-012 |
| Health checks | TASK-012 |
| Queue infrastructure — pg-boss + JobQueuePort (U-03) | TASK-013 |
| MockHaciendaAdapter + HaciendaPort (U-04) | TASK-013 |
| Object Storage abstraction | TASK-014 |
| SecretProvider — SSM Parameter Store (U-06) | TASK-015 |
| Docker multi-stage | TASK-016 |
| CI/CD — GitHub Actions con gates (U-07) | TASK-017 |
| Tests (domain + integration + E2E) | TASK-018 |
| Separación de módulos y capas | TASK-001, TASK-002 |
| API Key secret — hash one-way, visible una vez (U-10) | TASK-009 |
| Billing/Inventori completamente independientes (U-10) | TASK-001 |

---

## 5. Current Problems Addressed

| ID | Problema | Descripción | Tarea |
|---|---|---|---|
| P-01 | Sistema no existe | Proyecto greenfield — todo por construir | TASK-001 |
| P-02 | Multi-tenancy retroactivo | Añadir tenant_id después es riesgoso | TASK-005 — hacerlo en Stage 0.2 antes de cualquier módulo de dominio |
| P-03 | Secretos sin estrategia | Sin Secret Management desde el inicio | TASK-015 |
| P-04 | Falta de trazabilidad | Sin Correlation ID ni audit log estructurado | TASK-010, TASK-011 |
| P-05 | Falta de contrato API | Sin OpenAPI/tipos definidos | TASK-012 |
| P-06 | Acoplamiento Hacienda | Sin abstracción, no se puede desarrollar sin conectividad real | TASK-013 (MockHaciendaAdapter) |
| P-07 | Redis innecesario | La arquitectura anterior incluía Redis solo para queue | Eliminado — pg-boss usa PostgreSQL |

---

## 6. Domains Affected

| Dominio | Módulo | Tipo | Fase |
|---|---|---|---|
| Identity | identity | Core | Fase 0 |
| Companies | companies | Core | Fase 0 |
| API Keys | api-keys | Core | Fase 0 |
| Audit | audit | Generic | Fase 0 |
| Shared Kernel | shared | Técnico | Fase 0 |

---

## 7. Behavior to Preserve

No hay comportamiento previo que preservar (proyecto greenfield).

Las invariantes de negocio que deben garantizarse desde el inicio:

1. **API Key secret**: hash one-way con argon2id. Visible exactamente una vez en el response de creación. Nunca recuperable.
2. **Aislamiento tenant**: ninguna query sin `tenant_id` filter. Toda query pasa por TenantContext.
3. **Audit log**: append-only, sin `UPDATE` ni `DELETE`. Inmutable por diseño.
4. **Secretos**: nunca en logs, nunca en respuestas API (excepto el secret de API Key en el momento de creación).
5. **UUID generados en la aplicación**, no en la BD, para predictabilidad en tests.
6. **API Keys**: scopes, autorización explícita por company, separación LIVE/TEST.
7. **JWTs de usuario**: nunca como credenciales de integración permanentes.

---

## 8. Defects to Correct

No aplica — proyecto greenfield.

---

## 9. Future Architectural Changes

Los siguientes cambios están previstos para fases futuras. El diseño de Fase 0 debe acomodarlos sin bloquearlos:

| Cambio futuro | Preparación en Fase 0 |
|---|---|
| Módulo Taxpayers (Fase 1) | HaciendaPort disponible, MockHaciendaAdapter listo |
| Módulo CABYS (Fase 1) | HaciendaPort disponible, StoragePort para caché si se requiere |
| Rate limiting (Fase 1) | ThrottlerModule fácil de añadir a NestJS |
| PostgreSQL RLS (Fase 1+) | Schema compatible, puede activarse sin nueva migración |
| Circuit breaker (Fase 1) | Hacienda ya está aislada en adapter |
| HaciendaConnection / credenciales fiscales (Fase 2) | SecretProvider listo, SSM configurado |
| FiscalDocuments (Fase 3) | Módulo audit reusable, TenantContext disponible, HaciendaPort listo |
| XAdES signing (Fase 3) | Spike a iniciar independientemente. XmlSignerPort definido. |
| Async pipeline (Fase 4) | pg-boss infrastructure lista. JobQueuePort disponible. |
| Storage de XML/PDF (Fase 5) | StoragePort lista |
| Email (Fase 5) | Worker infrastructure lista — añadir EmailPort en Fase 5 |
| Webhooks (Fase 4) | Módulo audit extensible, JobQueuePort disponible |
| UI (Fase 8) | JWT auth funcional desde Fase 0 |

---

## 10. Database Changes

### 10.1 Migración inicial (Fase 0)

Una única migración que crea el schema de Fase 0:

```
001_initial_foundation:
  - ENUM: tenant_status, tenant_plan, user_status, user_role
  - ENUM: company_status, identification_type
  - ENUM: api_key_status, api_key_env
  - TABLE: tenants
  - TABLE: companies
  - TABLE: users
  - TABLE: api_keys
  - TABLE: api_key_companies
  - TABLE: audit_logs
  - INDEXES: según schema de la sección 7.2 de architecture.md
```

pg-boss crea sus propias tablas en el schema `pgboss` de forma automática al inicializar — no requiere migración de aplicación.

### 10.2 Principios de migración

- Nunca modificar una migración ya aplicada en ambientes compartidos.
- Nuevas fases = nuevas migraciones numeradas (`002_...`, `003_...`).
- Las migraciones son idempotentes cuando sea posible.
- Se ejecutan automáticamente al arrancar en desarrollo (`prisma migrate dev`).
- En staging/producción: `prisma migrate deploy` como paso explícito de CI/CD **antes** del deploy del servicio.

### 10.3 Consideraciones de performance

- Índices en `tenant_id` + campos de query frecuente desde el inicio.
- `audit_logs` puede crecer agresivamente → índice compuesto en `(tenant_id, created_at DESC)` desde el inicio.
- Política de retención de audit_logs: configurable. Confirmar período legal CR antes de producción. (ADR-009)

---

## 11. API and Integration Changes

### 11.1 API nueva (Fase 0) — todo es nuevo

```
# Sin autenticación
GET    /health
GET    /health/ready
GET    /health/live

# Auth de usuarios — JWT
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh

# Tenants — admin interno
POST   /api/v1/tenants
GET    /api/v1/tenants/{id}

# Companies — tenant admin
POST   /api/v1/companies
GET    /api/v1/companies/{id}

# API Keys — tenant admin
POST   /api/v1/api-keys
GET    /api/v1/api-keys
DELETE /api/v1/api-keys/{id}
```

### 11.2 Convenciones establecidas para todas las fases futuras

- Formato de error: `{ error: { code, message, correlationId, timestamp } }`
- Autenticación: JWT (header `Authorization: Bearer`) o API Key (header `X-API-Key`)
- Correlation ID: `X-Correlation-ID` en request y response
- API Key format: `bk_{env}_{8-char-prefix}_{32-char-secret}`

---

## 12. Container and Deployment Changes

### 12.1 Nuevo: Docker setup completo

```yaml
# Servicios en docker-compose.yml
billing-api      (puerto 3000)
billing-worker   (sin puerto HTTP de negocio)
postgres:15-alpine
localstack       (S3 local — puerto 4566)
```

**Sin Redis.** No se introduce infraestructura sin necesidad demostrada. (ADR-003)

### 12.2 Nuevo: Dockerfile multi-stage

- `deps`: instala dependencias con `npm ci`
- `builder`: compila TypeScript, poda dependencias de dev
- `runner`: imagen mínima, usuario non-root `billing`, HEALTHCHECK

### 12.3 Preparación para AWS ECS

- Health check endpoints compatibles con ALB target group health checks
- Variables de entorno como único mecanismo de configuración externa
- Graceful shutdown con `SIGTERM` handling
- Sin estado en el proceso (stateless API — pg-boss no requiere sticky sessions)
- Imagen única para API y Worker, diferenciados por `CMD`

---

## 13. Security Changes

### 13.1 Controles de seguridad implementados en Fase 0

| Control | Implementación | Tarea |
|---|---|---|
| API Key secret — hash one-way | argon2id | TASK-009 |
| Password hash | argon2id | TASK-007 |
| JWT con expiración corta | 15 min access + 7d refresh | TASK-007 |
| Input validation global | ValidationPipe whitelist | TASK-011 |
| Secrets externalizados | SecretProvider — SSM en prod, env en dev | TASK-015 |
| Non-root container | Dockerfile `USER billing` | TASK-016 |
| Tenant isolation | TenantContext + repository filter | TASK-005 |
| Audit log inmutable | append-only, sin UPDATE/DELETE | TASK-010 |
| No secrets en logs | Pino redaction config + AuditInterceptor | TASK-011 |
| API Key separación test/live | `ApiKeyEnv` enum + validación en guard | TASK-009 |

### 13.2 Controles diferidos (Fase 1+)

- Rate limiting con `@nestjs/throttler`
- Helmet (headers HTTP de seguridad)
- CORS configurado para origins permitidos
- PostgreSQL RLS como capa adicional de aislamiento
- KMS encryption explícita para credenciales Hacienda (Fase 2)

---

## 14. Test Strategy

### 14.1 Tests requeridos en Fase 0

**Unit tests — dominio:**
- `Tenant` entity: invariantes (slug único, status transitions), lifecycle
- `Company` entity: invariantes (identificación fiscal válida), status
- `User` entity: invariantes (email único por tenant, password hash never exposed)
- `ApiKey` entity: generación de key format, revocación, expiration, scopes
- Value Objects: `Email`, `TenantSlug`, `IdentificationNumber`, `ApiKeyPrefix`, `ApiKeySecret`
- Domain exceptions: mensajes y códigos correctos

**Unit tests — application:**
- `CreateTenantHandler`: happy path + slug duplicado
- `CreateCompanyHandler`: happy path + identificación duplicada
- `CreateApiKeyHandler`: secret nunca expuesto excepto en response inicial; hash verificable
- `RevokeApiKeyHandler`: idempotente si ya estaba revocada
- `ListApiKeysHandler`: filtrado correcto por tenant
- `LoginHandler`: credenciales correctas + incorrectas + usuario inactivo
- `RefreshTokenHandler`: token válido + expirado + rotación

**Integration tests — infraestructura:**
- `TenantPrismaRepository`: CRUD real contra PostgreSQL de test
- `CompanyPrismaRepository`: CRUD + unique constraint
- `ApiKeyPrismaRepository`: create + revoke + lookup by prefix
- `AuditLogPrismaRepository`: insert + no permite update/delete

**E2E tests — API:**
- Flow completo: `POST /auth/login` → `POST /api-keys` → `GET /api-keys` → `DELETE /api-keys/{id}`
- Verificar que el `secret` de API Key aparece en `201` y **no aparece** en `GET /api-keys`
- Verificar que cada operación genera un `audit_log`
- Verificar aislamiento de tenants: tenant A no puede ver datos de tenant B
- Verificar que token expirado retorna `401`
- Verificar que API Key revocada retorna `401`

### 14.2 Cobertura esperada

- Domain layer: >90% de statements
- Application layer: >80% de statements
- Infrastructure: cubierto por integration tests
- Priorizar calidad de tests sobre porcentaje numérico

---

## 15. Migration Stages

### Stage 0.1: Scaffold y kernel (TASK-001, TASK-002, TASK-003)
**Duración estimada:** 2–3 días
**Resultado:** Proyecto NestJS corriendo localmente. Capas hexagonales definidas. Config por ambiente validada.
**Gate:** `npm run start:dev` responde en `:3000/health`. TypeScript compila sin errores.

### Stage 0.2: Persistencia y multi-tenancy (TASK-004, TASK-005)
**Duración estimada:** 2–3 días
**Resultado:** PostgreSQL conectado via Prisma. Primera migración aplicada. TenantContext funcionando en tests.
**Gate:** `prisma migrate dev` corre sin errores. Test de aislamiento de TenantContext pasa.

### Stage 0.3: Módulos de dominio (TASK-006, TASK-007, TASK-008, TASK-009)
**Duración estimada:** 5–7 días
**Resultado:** Identity (Tenant, User, Auth), Companies y API Keys implementados. Unit tests del dominio verdes.
**Gate:** `npm run test` — 0 failures. Use cases funcionan con repositorios in-memory.

### Stage 0.4: Cross-cutting concerns (TASK-010, TASK-011, TASK-012)
**Duración estimada:** 2–3 días
**Resultado:** Audit log, Correlation ID, logging con Pino, error handling global, Swagger, health checks.
**Gate:** Cada request genera audit entry. `GET /api/docs` muestra Swagger UI completo.

### Stage 0.5: Infraestructura base async y ports (TASK-013, TASK-014, TASK-015)
**Duración estimada:** 2–3 días
**Resultado:** pg-boss + JobQueuePort funcionales (con InMemoryJobQueue en tests). StoragePort lista. SecretProvider funcional con EnvSecretProvider. MockHaciendaAdapter disponible.
**Gate:** Job de smoke test encolado y procesado. LocalStack S3 funcional. SecretProvider retorna secret desde env.

### Stage 0.6: Contenedores y CI/CD (TASK-016, TASK-017)
**Duración estimada:** 2–3 días
**Resultado:** `docker-compose up` levanta todo el stack. GitHub Actions en verde en cada push.
**Gate:** `docker-compose up` → todos los servicios healthy. CI pipeline verde en rama main.

### Stage 0.7: Tests completos y verificación final (TASK-018, TASK-019)
**Duración estimada:** 2–3 días
**Resultado:** Tests E2E cubriendo flujos principales. README completo. docs actualizados.
**Gate:** `npm run test:e2e` — 0 failures. Manual validation checklist V-01 a V-15 completado.

**Duración total estimada Fase 0:** 17–25 días de desarrollo

---

## 16. Risks and Mitigations

| ID | Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|---|
| R-01 | Multi-tenancy mal implementado desde el inicio | Medio | Critical | TenantContext en Stage 0.2 antes de cualquier módulo. Tests de aislamiento obligatorios. |
| R-02 | Domain entities acopladas a Prisma | Alto | High | Revisión de código estricta. ESLint rule que prohíbe `@prisma/client` en `domain/`. |
| R-03 | API Key secret expuesto en logs | Medio | Critical | AuditInterceptor redacta campos sensibles. Logger configurado con redact paths. |
| R-04 | pg-boss no conecta o crea tablas correctamente | Bajo | High | Tests de smoke del queue en CI. Verificación en Stage 0.5. |
| R-05 | NestJS circular dependencies | Medio | High | Arquitectura modular estricta. Reglas de importación documentadas. Detección temprana con NestJS detector. |
| R-06 | AsyncLocalStorage pierde contexto en async operations | Medio | High | Tests específicos de propagación de contexto en promesas anidadas. |
| R-07 | Scope creep hacia Fase 1 durante implementación | Alto | Medium | Fase 0 no incluye nada de Hacienda. Revisiones de scope en cada PR. |
| R-08 | Spike XAdES tarda más de lo esperado | Medio | Medium | El spike puede iniciar en paralelo con Fase 0 — no bloquea Fase 0. Solo bloquea Fase 3. |
| R-09 | Secrets en variables de entorno en CI | Medio | High | GitHub Secrets para todos los valores sensibles en CI. `.env.local` nunca commiteado. |
| R-10 | Docker image demasiado grande | Bajo | Low | Multi-stage build. `.dockerignore` completo. Pruner de dependencias de dev. |

---

## 17. Rollback or Recovery Strategy

### Durante desarrollo (pre-producción)
- Cada Stage produce un branch separado y un Pull Request revisable.
- Las migraciones de Fase 0 son todas nuevas — no hay producción que proteger.
- Si una migración falla en dev: `prisma migrate reset` o migración de rollback manual.

### En staging/producción (cuando exista)
- Todas las migraciones son hacia adelante (forward-only). Nunca modificar una migración ya aplicada.
- Rollback de schema: nueva migración que revierte el cambio (down migration manual).
- Rollback de deployment: imagen Docker anterior disponible en ECR/registry.
- Graceful shutdown con `SIGTERM`: los jobs en vuelo se completan antes de detener el worker.
- pg-boss tiene mecanismo de recovery de jobs parcialmente procesados.

---

## 18. Manual Validation

Antes de considerar Fase 0 completa, validar manualmente:

| # | Validación | Criterio de aceptación |
|---|---|---|
| V-01 | `docker-compose up` levanta todos los servicios | Todos los contenedores en estado healthy |
| V-02 | Migrations corren automáticamente | Tablas creadas en PostgreSQL local + schema pgboss creado por pg-boss |
| V-03 | `POST /api/v1/auth/login` con credenciales correctas | `200 OK` con `accessToken` + `refreshToken` |
| V-04 | `POST /api/v1/auth/login` con credenciales incorrectas | `401 Unauthorized` con código de error |
| V-05 | `POST /api/v1/tenants` crea un tenant | `201 Created` con `id` y `slug` |
| V-06 | `POST /api/v1/companies` crea una company | `201 Created`, asociada al tenant correcto |
| V-07 | `POST /api/v1/api-keys` crea key y muestra secret una vez | `secret` en `201`, **ausente** en `GET /api/v1/api-keys` |
| V-08 | `DELETE /api/v1/api-keys/{id}` revoca la key | `204 No Content`, estado `REVOKED` en DB |
| V-09 | API Key revocada retorna error al usarse | `401 Unauthorized` |
| V-10 | Todas las operaciones generan registro en `audit_logs` | Verificar en tabla `audit_logs` |
| V-11 | `X-Correlation-ID` se propaga en logs y response headers | `correlationId` en logs estructurados y en header de response |
| V-12 | `GET /health/ready` retorna `200` con DB ok | `{ "status": "ok", "db": "ok" }` |
| V-13 | `GET /api/docs` muestra Swagger UI completo | Todos los endpoints documentados con DTOs |
| V-14 | `npm run test` — todos los tests pasan | 0 failures |
| V-15 | `npm run test:e2e` — todos los E2E pasan | 0 failures |
| V-16 | `npm run build` compila sin errores TypeScript | Exit 0, 0 type errors |
| V-17 | CI/CD pipeline pasa en GitHub Actions | Verde en rama main |
| V-18 | Tenant A no puede ver datos de Tenant B | Test de aislamiento multi-tenant + verificación manual |
| V-19 | No hay secretos commiteados en el repositorio | `git log` + búsqueda de patrones de secrets |
| V-20 | Job de smoke test encolado y procesado via pg-boss | Log del worker muestra job completado |

---

## 19. Approval Status

**Estado:** ✅ **Aprobado** — Todas las decisiones U-01 a U-10 han sido confirmadas.

| Decisión | Estado | ADR |
|---|---|---|
| U-01: NestJS + TypeScript + Monolito Modular | ✅ Aprobado | ADR-001 |
| U-02: Prisma + PostgreSQL + argon2id + AsyncLocalStorage | ✅ Aprobado | ADR-002 |
| U-03: pg-boss como queue, sin Redis | ✅ Aprobado | ADR-003 |
| U-04: HaciendaPort + MockHaciendaAdapter obligatorio | ✅ Aprobado | ADR-004 |
| U-05: XAdES — Technical Spike, XmlSignerPort abstraction | ✅ Spike aprobado | ADR-005 |
| U-06: AWS SSM Parameter Store + SecretProvider abstraction | ✅ Aprobado | ADR-006 |
| U-07: GitHub Actions + gates obligatorios | ✅ Aprobado | ADR-007 |
| U-08: Auth + AuthZ (JWT + API Keys) desde Fase 0 | ✅ Aprobado | ADR-008 |
| U-09: Retención configurable, confirmar requisito legal CR | ✅ Aprobado | ADR-009 |
| U-10: Billing e Inventori completamente independientes | ✅ Aprobado | ADR-010 |

**Para iniciar implementación:** invocar al agente de implementación con "implementa las tareas aprobadas" o similar.
