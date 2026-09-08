# Tasks — Billing Fase 0: Foundation

> **Versión:** 1.0
> **Fecha:** 2025
> **Estado:** Aprobadas — Decisiones U-01 a U-10 confirmadas
> **Propietario:** hdd-architecture-agent-e257ee
> **Scope:** Fase 0 Foundation

---

## Orden de ejecución

```
TASK-001 → TASK-002 → TASK-003
                            ↓
                       TASK-004 → TASK-005
                                      ↓
              TASK-006 ─┬─ TASK-007 ─┬─ TASK-008 ─┬─ TASK-009
                        └────────────┴────────────┘
                                      ↓
                       TASK-010 → TASK-011 → TASK-012
                                                   ↓
                       TASK-013 ─┬─ TASK-014 ─┬─ TASK-015
                                 └────────────┘
                                               ↓
                                   TASK-016 → TASK-017
                                                   ↓
                                   TASK-018 → TASK-019
```

---

## TASK-001: Project Scaffold — NestJS Monorepo Base

**Status:** Proposed
**Priority:** Critical
**Domain:** Shared / Infrastructure
**Requirement:** U-01 — NestJS + TypeScript + Monolito Modular
**Reason:** Sin scaffold no hay base sobre la cual construir nada. Primera tarea obligatoria.
**Current problem:** El proyecto no existe como codebase.
**Proposed change:**
Crear el proyecto NestJS con TypeScript en strict mode. Establecer la estructura de directorios hexagonal. Configurar herramientas de calidad de código.

Estructura a crear:
```
src/
  bootstrap/
    api.main.ts
    worker.main.ts
  modules/
  infrastructure/
  api/
  workers/
prisma/
test/
  e2e/
.github/
  workflows/
```

Configuraciones:
- `tsconfig.json` con `strict: true`, `target: ES2022`, paths aliases
- `tsconfig.build.json` para excluir tests del build de producción
- `.eslintrc.js` con reglas: no-domain-imports-from-infra, no-circular-deps, @typescript-eslint/recommended
- `.prettierrc`
- `package.json` con scripts: `start:api`, `start:worker`, `build`, `test`, `test:e2e`, `test:cov`, `lint`, `typecheck`
- `.env.local.example` con todas las variables necesarias
- `.gitignore` (node_modules, dist, .env.local, *.p12)
- `.dockerignore`
- `README.md` mínimo con instrucciones de setup local

**Affected files:**
- `package.json`, `tsconfig.json`, `tsconfig.build.json`, `.eslintrc.js`, `.prettierrc`
- `src/bootstrap/api.main.ts`, `src/bootstrap/worker.main.ts`
- `src/app.module.ts` (raíz)
- `.env.local.example`, `.gitignore`, `.dockerignore`, `README.md`

**Dependencies:** Ninguna
**Database impact:** Ninguno
**API impact:** Ninguno (el servidor arranca pero sin endpoints de negocio)
**Container impact:** Ninguno (preparación para TASK-016)
**Security impact:** Bajo — configurar `.gitignore` para excluir `.env.local` y archivos de certificados

**Acceptance criteria:**
- [ ] `npm install` se completa sin errores
- [ ] `npm run build` produce dist/ sin errores TypeScript
- [ ] `npm run start:dev` arranca el servidor en puerto 3000
- [ ] `npm run lint` retorna 0 errores
- [ ] `npm run typecheck` retorna 0 errores
- [ ] `.env.local` está en `.gitignore`
- [ ] Estructura de directorios coincide con architecture.md sección 3.3

**Required tests:**
- Ningún test de negocio en esta tarea. El scaffold incluye configuración de Jest.

**Migration considerations:** N/A
**Rollback or mitigation:** Eliminar el directorio y comenzar de nuevo. Sin impacto en producción.
**Risk:** Low

---

## TASK-002: Shared Domain Kernel

**Status:** Proposed
**Priority:** Critical
**Domain:** Shared
**Requirement:** U-01 — Hexagonal Architecture, separación Domain/Application/Infrastructure
**Reason:** Las base classes del dominio son necesarias antes de implementar cualquier entity o aggregate.
**Current problem:** No existen abstracciones base de dominio.
**Proposed change:**
Crear el módulo `shared` con el kernel técnico de dominio. Estas son clases abstractas y tipos base, no lógica de negocio.

Componentes a crear:
```typescript
// Base entity con identity y timestamps
abstract class BaseEntity<TId> {
  protected readonly id: TId;
  readonly createdAt: Date;
  updatedAt: Date;
}

// Base aggregate root (extiende BaseEntity)
abstract class AggregateRoot<TId> extends BaseEntity<TId> {
  private _domainEvents: DomainEvent[] = [];
  addDomainEvent(event: DomainEvent): void;
  clearDomainEvents(): DomainEvent[];
}

// Base value object con equals por valor
abstract class ValueObject<T extends object> {
  protected readonly props: T;
  equals(other: ValueObject<T>): boolean;
}

// Base domain event
abstract class DomainEvent {
  readonly occurredAt: Date;
  readonly correlationId?: string;
}

// Base domain exception
abstract class DomainException extends Error {
  abstract readonly code: string;
}

// Repository interface base
interface Repository<T, TId> {
  findById(id: TId): Promise<T | null>;
  save(entity: T): Promise<void>;
}
```

**Affected files:**
- `src/modules/shared/domain/base-entity.ts`
- `src/modules/shared/domain/aggregate-root.ts`
- `src/modules/shared/domain/value-object.ts`
- `src/modules/shared/domain/domain-event.ts`
- `src/modules/shared/domain/domain-exception.ts`
- `src/modules/shared/domain/repository.interface.ts`
- `src/modules/shared/shared.module.ts`

**Dependencies:** TASK-001
**Database impact:** Ninguno
**API impact:** Ninguno
**Container impact:** Ninguno
**Security impact:** Ninguno

**Acceptance criteria:**
- [ ] Todas las clases base son abstractas e importables
- [ ] `AggregateRoot` acumula y limpia domain events
- [ ] `ValueObject.equals()` compara por valor estructural, no por referencia
- [ ] Ninguna clase en `shared/domain/` importa NestJS, Prisma, pg-boss ni cualquier framework

**Required tests:**
- `src/modules/shared/domain/__tests__/value-object.spec.ts` — equals por valor
- `src/modules/shared/domain/__tests__/aggregate-root.spec.ts` — accumulation y clear de events

**Migration considerations:** N/A
**Rollback or mitigation:** Sin impacto en producción.
**Risk:** Low

---

## TASK-003: Configuration Module

**Status:** Proposed
**Priority:** High
**Domain:** Infrastructure / Shared
**Requirement:** Billing_Plan_Desarrollo.md — Configuración por ambiente
**Reason:** Sin configuración validada, los servicios pueden arrancar con valores incorrectos o secretos ausentes.
**Current problem:** No existe configuración tipada ni validada.
**Proposed change:**
Configurar `@nestjs/config` con validación de schema (Joi o zod). Variables de entorno tipadas y accesibles de forma segura.

Namespaces de configuración:
- `app`: NODE_ENV, PORT, LOG_LEVEL
- `database`: DATABASE_URL
- `auth`: JWT_SECRET, JWT_EXPIRES_IN, JWT_REFRESH_EXPIRES_IN
- `storage`: STORAGE_TYPE, AWS_S3_BUCKET, AWS_S3_ENDPOINT
- `secrets`: SECRET_PROVIDER, SSM_PARAMETER_PREFIX, AWS_REGION

**Affected files:**
- `src/infrastructure/config/app.config.ts`
- `src/infrastructure/config/database.config.ts`
- `src/infrastructure/config/auth.config.ts`
- `src/infrastructure/config/storage.config.ts`
- `src/infrastructure/config/secrets.config.ts`
- `src/infrastructure/config/config.module.ts`
- `.env.local.example` (actualizado con todas las variables)

**Dependencies:** TASK-001
**Database impact:** Ninguno
**API impact:** Ninguno
**Container impact:** Variables de entorno documentadas para docker-compose
**Security impact:** Medium — validación de presencia de variables críticas previene arranque sin secrets requeridos

**Acceptance criteria:**
- [ ] La aplicación falla al arrancar si falta una variable de entorno requerida
- [ ] Todas las variables tienen tipos TypeScript correctos
- [ ] `DATABASE_URL` es requerida siempre
- [ ] `JWT_SECRET` es requerida en producción (puede tener default inseguro en dev con warning)
- [ ] Ningún secret se loggea al arrancar

**Required tests:**
- Test de arranque con variables completas: OK
- Test de arranque con `DATABASE_URL` ausente: proceso termina con error descriptivo

**Migration considerations:** N/A
**Rollback or mitigation:** Restaurar `.env.local.example` previo.
**Risk:** Low

---

## TASK-004: Database Setup — Prisma + PostgreSQL + Migración Inicial

**Status:** Proposed
**Priority:** Critical
**Domain:** Infrastructure
**Requirement:** U-02 — Prisma + PostgreSQL. Multi-tenancy desde la primera migración.
**Reason:** La base de datos y el schema deben existir antes de implementar cualquier repositorio.
**Current problem:** No existe schema ni conexión a base de datos.
**Proposed change:**
Inicializar Prisma. Crear el schema completo de Fase 0 (ver architecture.md sección 7.2). Crear la primera migración. Configurar el módulo de database en NestJS.

Schema incluye:
- ENUMs: TenantStatus, TenantPlan, UserStatus, UserRole, CompanyStatus, IdentificationType, ApiKeyStatus, ApiKeyEnv
- Tablas: tenants, companies, users, api_keys, api_key_companies, audit_logs
- Índices según architecture.md sección 7.2
- `tenant_id` en todas las tablas tenant-aware

Scripts en package.json:
```json
{
  "db:migrate:dev": "prisma migrate dev",
  "db:migrate:deploy": "prisma migrate deploy",
  "db:generate": "prisma generate",
  "db:studio": "prisma studio",
  "db:reset": "prisma migrate reset"
}
```

**Affected files:**
- `prisma/schema.prisma`
- `prisma/migrations/20250001_initial_foundation/migration.sql`
- `src/infrastructure/database/prisma.service.ts`
- `src/infrastructure/database/database.module.ts`
- `package.json` (scripts)

**Dependencies:** TASK-001, TASK-003
**Database impact:** Critical — crea todas las tablas y ENUMs de Fase 0
**API impact:** Ninguno directo
**Container impact:** PostgreSQL container debe estar corriendo
**Security impact:** High — `DATABASE_URL` con credenciales nunca hardcodeada. Solo en variables de entorno.

**Acceptance criteria:**
- [ ] `npm run db:migrate:dev` crea todas las tablas sin errores
- [ ] `npx prisma generate` genera el Prisma Client
- [ ] `PrismaService` extiende `PrismaClient` y hace `$connect` en `onModuleInit`
- [ ] `PrismaService` cierra la conexión en `onModuleDestroy`
- [ ] Todas las tablas tienen `tenant_id` donde corresponde
- [ ] ENUMs creados correctamente
- [ ] Índices creados según el schema de architecture.md

**Required tests:**
- Integration test: `PrismaService` conecta correctamente a PostgreSQL de test
- Verificar que la tabla `audit_logs` no tiene triggers de UPDATE/DELETE (append-only enforcement futuro)

**Migration considerations:**
- Esta es la migración 001. Nunca modificar esta migración una vez aplicada en ambientes compartidos.
- pg-boss crea su schema `pgboss` automáticamente al inicializar — no requiere migración manual.

**Rollback or mitigation:** `prisma migrate reset` en desarrollo. En producción: nueva migración de rollback.
**Risk:** High — schema incorrecto desde el inicio es costoso de corregir.

---

## TASK-005: Multi-tenancy — TenantContext + AsyncLocalStorage

**Status:** Proposed
**Priority:** Critical
**Domain:** Infrastructure / Shared
**Requirement:** U-02 — Multi-tenancy row-level con AsyncLocalStorage
**Reason:** El aislamiento multi-tenant debe estar disponible antes de implementar cualquier repositorio. Añadirlo retroactivamente es el riesgo más alto del proyecto.
**Current problem:** No existe mecanismo de tenant context.
**Proposed change:**
Implementar `TenantContext` usando `AsyncLocalStorage`. Crear middleware/guard que establece el contexto. Crear base repository con filtrado automático por `tenantId`.

Componentes:
```typescript
// src/infrastructure/tenant/tenant-context.ts
class TenantContext {
  private static storage = new AsyncLocalStorage<{ tenantId: string }>();
  static run<T>(tenantId: string, fn: () => Promise<T>): Promise<T>;
  static getTenantId(): string;  // throws si no hay contexto activo
}

// src/infrastructure/tenant/tenant-context.middleware.ts
// Middleware que lee tenantId del request (del token JWT o API Key) y establece el contexto

// Base repository con tenant filtering automático
abstract class TenantAwarePrismaRepository<T> {
  protected get tenantId(): string { return TenantContext.getTenantId(); }
  protected applyTenantFilter<Q>(query: Q): Q & { where: { tenantId: string } };
}
```

**Affected files:**
- `src/infrastructure/tenant/tenant-context.ts`
- `src/infrastructure/tenant/tenant-context.middleware.ts`
- `src/infrastructure/tenant/tenant.module.ts`
- `src/infrastructure/database/tenant-aware-prisma.repository.ts`

**Dependencies:** TASK-004
**Database impact:** Ninguno adicional — refuerza el uso de tenant_id ya en el schema
**API impact:** Ninguno directo — es infraestructura interna
**Container impact:** Ninguno
**Security impact:** Critical — aislamiento multi-tenant es la garantía de seguridad principal entre tenants

**Acceptance criteria:**
- [ ] `TenantContext.run(tenantId, fn)` establece el contexto correctamente en el scope async
- [ ] `TenantContext.getTenantId()` lanza `TenantContextNotSetException` si no hay contexto activo
- [ ] Los repositorios que extienden `TenantAwarePrismaRepository` siempre incluyen `WHERE tenant_id = $tenantId`
- [ ] El contexto se propaga correctamente en promesas anidadas y callbacks
- [ ] Un repositorio sin contexto establecido NO ejecuta queries cross-tenant

**Required tests:**
- `src/infrastructure/tenant/__tests__/tenant-context.spec.ts`:
  - Contexto disponible dentro de `run()`
  - Contexto no disponible fuera de `run()`
  - Propagación en promesas anidadas
  - Aislamiento entre llamadas paralelas con diferentes tenantIds
- Integration test: dos tenants con datos, verificar que cada repositorio solo retorna datos del tenant activo

**Migration considerations:** N/A
**Rollback or mitigation:** Sin impacto en producción (sin datos aún).
**Risk:** Critical — bugs aquí comprometen el aislamiento de todos los tenants.

---

## TASK-006: Identity Module — Tenant Entity y Use Cases

**Status:** Proposed
**Priority:** Critical
**Domain:** identity
**Requirement:** Billing_Plan_Desarrollo.md — Tenant. U-08 — Auth desde Fase 0.
**Reason:** Tenant es el agregado raíz del SaaS. Sin Tenant no hay ningún otro concepto.
**Current problem:** No existe módulo identity.
**Proposed change:**
Implementar el subdominio de Tenant dentro del módulo identity.

Componentes de dominio:
```
domain/
  entities/tenant.entity.ts      ← TenantId, name, slug, status, plan
  value-objects/
    tenant-slug.vo.ts             ← slugify, validación formato
    tenant-name.vo.ts
  events/tenant-created.event.ts
  exceptions/
    tenant-not-found.exception.ts
    tenant-slug-already-exists.exception.ts
  ports/tenant.repository.ts     ← ITenantRepository interface
```

Use cases:
- `CreateTenant`: crea Tenant con slug único, estado ACTIVE, plan TRIAL
- `GetTenant`: busca por ID, retorna DTO

Infrastructure:
- `PrismaTenantRepository` implementa `ITenantRepository`
- `TenantController`: `POST /api/v1/tenants`, `GET /api/v1/tenants/{id}`
- DTOs: `CreateTenantRequestDto`, `TenantResponseDto`

**Affected files:**
- `src/modules/identity/domain/entities/tenant.entity.ts`
- `src/modules/identity/domain/value-objects/tenant-slug.vo.ts`
- `src/modules/identity/domain/value-objects/tenant-name.vo.ts`
- `src/modules/identity/domain/events/tenant-created.event.ts`
- `src/modules/identity/domain/exceptions/tenant-not-found.exception.ts`
- `src/modules/identity/domain/exceptions/tenant-slug-already-exists.exception.ts`
- `src/modules/identity/domain/ports/tenant.repository.ts`
- `src/modules/identity/application/use-cases/create-tenant/`
- `src/modules/identity/application/use-cases/get-tenant/`
- `src/modules/identity/infrastructure/persistence/prisma-tenant.repository.ts`
- `src/modules/identity/infrastructure/http/tenant.controller.ts`
- `src/modules/identity/infrastructure/http/dtos/`
- `src/modules/identity/identity.module.ts`

**Dependencies:** TASK-005
**Database impact:** Usa tabla `tenants`
**API impact:** `POST /api/v1/tenants`, `GET /api/v1/tenants/{id}`
**Container impact:** Ninguno
**Security impact:** Medium — crear tenants es una operación admin. Requerirá autorización apropiada.

**Acceptance criteria:**
- [ ] `Tenant` entity tiene invariantes: slug no puede estar vacío, status válido
- [ ] `TenantSlug` VO genera slugs válidos (lowercase, sin espacios, sin caracteres especiales)
- [ ] `CreateTenantHandler` retorna error si el slug ya existe
- [ ] `PrismaTenantRepository` hace mapping correcto Prisma model → Tenant entity
- [ ] Ningún archivo en `domain/` importa Prisma, NestJS, o cualquier framework
- [ ] `GET /api/v1/tenants/{id}` retorna 404 con error estándar si el tenant no existe

**Required tests:**
- Unit: `tenant.entity.spec.ts` — invariantes, TenantSlug.create() con casos válidos e inválidos
- Unit: `create-tenant.handler.spec.ts` — happy path, slug duplicado
- Integration: `prisma-tenant.repository.integration.spec.ts` — CRUD real
- E2E: `POST /api/v1/tenants` → `GET /api/v1/tenants/{id}`

**Migration considerations:** Usa migración de TASK-004.
**Rollback or mitigation:** Sin impacto en producción.
**Risk:** Medium

---

## TASK-007: Identity Module — User, Auth (JWT)

**Status:** Proposed
**Priority:** Critical
**Domain:** identity
**Requirement:** U-08 — Auth + AuthZ desde Fase 0. JWT para humans.
**Reason:** La autenticación de usuarios administradores es necesaria para proteger todos los endpoints de administración desde Fase 0.
**Current problem:** No existe módulo de autenticación de usuarios.
**Proposed change:**
Implementar User entity y el flujo de autenticación JWT dentro del módulo identity.

Componentes de dominio:
```
domain/
  entities/user.entity.ts        ← UserId, tenantId, email, passwordHash, role, status
  value-objects/
    email.vo.ts                   ← validación formato email
    user-role.vo.ts
  exceptions/
    user-not-found.exception.ts
    invalid-credentials.exception.ts
    user-already-exists.exception.ts
  ports/user.repository.ts       ← IUserRepository interface
```

Use cases:
- `CreateUser`: crea usuario con password hasheado (argon2id)
- `Login`: valida credenciales, emite JWT access + refresh tokens
- `RefreshToken`: valida refresh token, emite nuevo par (rotación)

Infrastructure:
- `PrismaUserRepository` implementa `IUserRepository`
- `JwtStrategy` (NestJS Passport) — valida JWT y establece request user
- `JwtAuthGuard` — guard reutilizable para endpoints protegidos por JWT
- `AuthController`: `POST /api/v1/auth/login`, `POST /api/v1/auth/refresh`
- Secreto JWT leído de `SecretProvider`

**Affected files:**
- `src/modules/identity/domain/entities/user.entity.ts`
- `src/modules/identity/domain/value-objects/email.vo.ts`
- `src/modules/identity/domain/ports/user.repository.ts`
- `src/modules/identity/application/use-cases/create-user/`
- `src/modules/identity/application/use-cases/login/`
- `src/modules/identity/application/use-cases/refresh-token/`
- `src/modules/identity/infrastructure/persistence/prisma-user.repository.ts`
- `src/modules/identity/infrastructure/http/auth.controller.ts`
- `src/api/guards/jwt-auth.guard.ts`
- `src/api/strategies/jwt.strategy.ts`

**Dependencies:** TASK-006, TASK-015 (SecretProvider para JWT secret)
**Database impact:** Usa tabla `users`
**API impact:** `POST /api/v1/auth/login`, `POST /api/v1/auth/refresh`
**Container impact:** Ninguno
**Security impact:** Critical — hashing con argon2id, JWT TTL de 15 min, refresh rotation obligatoria

**Acceptance criteria:**
- [ ] Passwords nunca almacenados ni retornados en texto plano
- [ ] Hash con argon2id (no bcrypt, no sha256)
- [ ] JWT access token expira en 15 minutos
- [ ] Refresh token rota en cada uso (invalidar el anterior)
- [ ] `POST /api/v1/auth/login` con credenciales incorrectas retorna 401 genérico (sin revelar si el email existe)
- [ ] `JwtAuthGuard` deniega requests sin token válido con 401
- [ ] JWT secret leído de SecretProvider, no hardcodeado
- [ ] `User` entity nunca expone `passwordHash` en DTOs de respuesta

**Required tests:**
- Unit: `user.entity.spec.ts` — invariantes, email validation
- Unit: `login.handler.spec.ts` — credenciales correctas, incorrectas, usuario inactivo
- Unit: `refresh-token.handler.spec.ts` — token válido, expirado, ya usado
- Integration: `prisma-user.repository.integration.spec.ts`
- E2E: login → refresh → acceso a endpoint protegido

**Migration considerations:** N/A
**Rollback or mitigation:** Sin impacto en producción.
**Risk:** High — autenticación incorrecta es una vulnerabilidad crítica.

---

## TASK-008: Companies Module

**Status:** Proposed
**Priority:** High
**Domain:** companies
**Requirement:** Billing_Plan_Desarrollo.md — Company. Identificación fiscal CR.
**Reason:** Company es el actor principal del sistema fiscal. Cada comprobante pertenece a una Company.
**Current problem:** No existe módulo companies.
**Proposed change:**
Implementar el módulo `companies` completo.

Componentes de dominio:
```
domain/
  entities/company.entity.ts     ← CompanyId, tenantId, legalName, tradeName, identificationType, identificationNumber, status
  value-objects/
    identification-number.vo.ts  ← validación por tipo (física, jurídica, DIMEX, NITE)
    identification-type.vo.ts
  exceptions/
    company-not-found.exception.ts
    company-identification-already-exists.exception.ts
  ports/company.repository.ts
```

Use cases:
- `CreateCompany`: crea Company con identificación válida y única por tenant
- `GetCompany`: busca por ID dentro del tenant

**Affected files:**
- `src/modules/companies/domain/entities/company.entity.ts`
- `src/modules/companies/domain/value-objects/identification-number.vo.ts`
- `src/modules/companies/domain/value-objects/identification-type.vo.ts`
- `src/modules/companies/domain/ports/company.repository.ts`
- `src/modules/companies/application/use-cases/create-company/`
- `src/modules/companies/application/use-cases/get-company/`
- `src/modules/companies/infrastructure/persistence/prisma-company.repository.ts`
- `src/modules/companies/infrastructure/http/company.controller.ts`
- `src/modules/companies/infrastructure/http/dtos/`
- `src/modules/companies/companies.module.ts`

**Dependencies:** TASK-005
**Database impact:** Usa tabla `companies`
**API impact:** `POST /api/v1/companies`, `GET /api/v1/companies/{id}`
**Container impact:** Ninguno
**Security impact:** Medium — tenant isolation obligatorio, solo TENANT_ADMIN puede crear companies

**Acceptance criteria:**
- [ ] `IdentificationNumber` VO valida formato por tipo (física: 9 dígitos, jurídica: 10, etc.)
- [ ] Número de identificación único por tenant (no por sistema global)
- [ ] `GET /api/v1/companies/{id}` retorna 404 si la company no pertenece al tenant autenticado
- [ ] Ningún campo de company de otro tenant es accesible

**Required tests:**
- Unit: `company.entity.spec.ts` — validaciones de identificación por tipo
- Unit: `identification-number.vo.spec.ts` — casos válidos e inválidos por tipo CR
- Unit: `create-company.handler.spec.ts`
- Integration: `prisma-company.repository.integration.spec.ts`
- E2E: crear company, verificar aislamiento de tenant

**Migration considerations:** N/A
**Rollback or mitigation:** Sin impacto en producción.
**Risk:** Medium

---

## TASK-009: API Keys Module

**Status:** Proposed
**Priority:** Critical
**Domain:** api-keys
**Requirement:** U-10 — API Keys con scopes, separación test/live, revocación, audit. U-08 — Sistemas externos via API Keys.
**Reason:** Las API Keys habilitan el modelo API-first y son la forma en que Inventori y sistemas externos se conectan.
**Current problem:** No existe módulo api-keys.
**Proposed change:**
Implementar el módulo `api-keys` completo, incluyendo el guard de autenticación por API Key.

**Reglas críticas del dominio:**
1. El secret completo se genera una vez y se muestra exactamente una vez (en el response de creación)
2. Solo el hash argon2id del secret se almacena
3. El secret jamás se recupera ni se retorna en ningún otro endpoint
4. Formato: `bk_{env}_{8-char-prefix}_{32-char-secret}`
5. Lookup por prefix (no por hash) para eficiencia

Componentes de dominio:
```
domain/
  entities/api-key.entity.ts     ← ApiKeyId, tenantId, name, environment, keyPrefix, keyHash, scopes, status, expiresAt
  value-objects/
    api-key-prefix.vo.ts          ← 8 chars, alphanumeric
    api-key-secret.vo.ts          ← 32 chars random, generación segura
    api-key-environment.vo.ts     ← LIVE | TEST
    api-key-scope.vo.ts           ← validación de scopes permitidos
  events/
    api-key-created.event.ts
    api-key-revoked.event.ts
  exceptions/
    api-key-not-found.exception.ts
    api-key-already-revoked.exception.ts
    api-key-expired.exception.ts
    insufficient-scope.exception.ts
  ports/api-key.repository.ts
```

Use cases:
- `CreateApiKey`: genera prefix + secret, hashea secret, asocia companies, retorna secret en plain una vez
- `ListApiKeys`: lista sin exponer keyHash ni secret
- `RevokeApiKey`: revoca (idempotente si ya estaba revocada)
- `ValidateApiKey`: use case interno usado por el guard

Guard:
- `ApiKeyAuthGuard`: lee `X-API-Key` header, valida format, lookup por prefix, verifica hash, establece TenantContext

**Affected files:**
- `src/modules/api-keys/domain/entities/api-key.entity.ts`
- `src/modules/api-keys/domain/value-objects/`
- `src/modules/api-keys/domain/events/`
- `src/modules/api-keys/domain/exceptions/`
- `src/modules/api-keys/domain/ports/api-key.repository.ts`
- `src/modules/api-keys/application/use-cases/create-api-key/`
- `src/modules/api-keys/application/use-cases/list-api-keys/`
- `src/modules/api-keys/application/use-cases/revoke-api-key/`
- `src/modules/api-keys/application/use-cases/validate-api-key/`
- `src/modules/api-keys/infrastructure/persistence/prisma-api-key.repository.ts`
- `src/modules/api-keys/infrastructure/http/api-keys.controller.ts`
- `src/modules/api-keys/infrastructure/http/dtos/`
- `src/api/guards/api-key-auth.guard.ts`
- `src/modules/api-keys/api-keys.module.ts`

**Dependencies:** TASK-005, TASK-008
**Database impact:** Usa tablas `api_keys`, `api_key_companies`
**API impact:** `POST /api/v1/api-keys`, `GET /api/v1/api-keys`, `DELETE /api/v1/api-keys/{id}`
**Container impact:** Ninguno
**Security impact:** Critical — el secreto se muestra una sola vez y nunca se recupera

**Acceptance criteria:**
- [ ] El campo `secret` aparece ÚNICAMENTE en el response `201` de creación
- [ ] `GET /api/v1/api-keys` NO retorna `keyHash`, `secret`, ni `revokedBy`
- [ ] El hash almacenado es verificable con argon2id
- [ ] El lookup usa `keyPrefix` para encontrar el registro, luego verifica el secret con argon2id
- [ ] API Key de environment `TEST` no puede usarse en contextos de producción (validación futura)
- [ ] `RevokeApiKey` es idempotente — revocar una key ya revocada no lanza error
- [ ] Una API Key expirada retorna 401 con código `API_KEY_EXPIRED`
- [ ] Las companies asociadas se almacenan en `api_key_companies`
- [ ] `ApiKeyAuthGuard` establece `TenantContext` con el `tenantId` de la key

**Required tests:**
- Unit: `api-key.entity.spec.ts` — generación de key, revocación, expiración, invariantes de scopes
- Unit: `create-api-key.handler.spec.ts` — secret visible en response, hash verificable
- Unit: `revoke-api-key.handler.spec.ts` — idempotencia
- Unit: `validate-api-key.handler.spec.ts` — key válida, revocada, expirada, hash incorrecto
- Integration: `prisma-api-key.repository.integration.spec.ts`
- E2E: crear → GET (sin secret) → revocar → verificar 401 al usar revocada

**Migration considerations:** N/A
**Rollback or mitigation:** Sin impacto en producción.
**Risk:** Critical — seguridad de todas las integraciones externas depende de esto.

---

## TASK-010: Audit Module

**Status:** Proposed
**Priority:** High
**Domain:** audit
**Requirement:** U-09 — Audit logs append-only. Billing_Plan_Desarrollo.md — Auditoría completa.
**Reason:** La auditoría completa es un principio no negociable del producto.
**Current problem:** No existe módulo audit.
**Proposed change:**
Implementar el módulo `audit` con `AuditLog` append-only y el servicio de auditoría.

```typescript
// Application service (no domain service — audit es genérico)
class AuditService {
  async record(entry: CreateAuditLogDto): Promise<void>;
  async findByTenant(tenantId: string, pagination: PaginationDto): Promise<AuditLogDto[]>;
}

// AuditInterceptor registra cada request
// Campos: tenantId, companyId, apiKeyId, actor, action, resource,
//         endpoint, httpMethod, statusCode, ipAddress, correlationId,
//         durationMs, metadata, errorMessage
```

**Regla de diseño:** `AuditLog` es append-only. El repository solo expone `insert` y `find`. No hay `update` ni `delete`.

**Affected files:**
- `src/modules/audit/domain/entities/audit-log.entity.ts` (o model, ya que es append-only)
- `src/modules/audit/domain/ports/audit-log.repository.ts`
- `src/modules/audit/application/audit.service.ts`
- `src/modules/audit/infrastructure/persistence/prisma-audit-log.repository.ts`
- `src/modules/audit/audit.module.ts`

**Dependencies:** TASK-004
**Database impact:** Usa tabla `audit_logs`
**API impact:** Ninguno directo (el interceptor se añade en TASK-011)
**Container impact:** Ninguno
**Security impact:** High — logs son la evidencia de auditoría. Deben ser inmutables.

**Acceptance criteria:**
- [ ] `AuditLogRepository` solo expone `insert` y `findBy*` — sin `update`, sin `delete`
- [ ] El módulo no tiene lógica de negocio — es puramente genérico de registro
- [ ] `AuditService.record()` no bloquea la request principal si hay error al escribir
- [ ] Cada `AuditLog` tiene `correlationId` que lo vincula a la request

**Required tests:**
- Unit: `audit.service.spec.ts` — registra correctamente, no lanza si el repository falla
- Integration: `prisma-audit-log.repository.integration.spec.ts` — insert + find, verificar no hay update/delete

**Migration considerations:** N/A
**Rollback or mitigation:** Sin impacto en producción.
**Risk:** Medium

---

## TASK-011: Cross-cutting Concerns — Logging, Correlation ID, Error Handling

**Status:** Proposed
**Priority:** High
**Domain:** Infrastructure / API
**Requirement:** Billing_Plan_Desarrollo.md — Logging estructurado, Correlation ID, manejo centralizado de errores.
**Reason:** Estos concerns son transversales a todos los módulos y deben estar disponibles antes de integrar los módulos de dominio.
**Current problem:** No existe logging estructurado, correlation ID ni manejo global de errores.
**Proposed change:**
Implementar los interceptors, filtros y configuración de logging global.

Componentes:
1. **Pino Logger**: `nestjs-pino` con configuración JSON, redaction de campos sensibles (`password`, `secret`, `token`, `credential`, `keyHash`)
2. **CorrelationIdInterceptor**: genera UUID v4 si no viene en `X-Correlation-ID`, propaga a response y logs
3. **AuditInterceptor**: usa `AuditService` para registrar cada request con actor, timing, status
4. **GlobalExceptionFilter**: mapea excepciones de dominio (`DomainException`) a HTTP responses estándar; mapea errores desconocidos a 500 sin exponer stack trace
5. **ValidationPipe global**: `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`

Mapa de excepciones de dominio → HTTP:
```
DomainException (base)       → 400 Bad Request
EntityNotFoundException      → 404 Not Found
DuplicateEntityException     → 409 Conflict
InvalidCredentialsException  → 401 Unauthorized
InsufficientScopeException   → 403 Forbidden
```

**Affected files:**
- `src/api/interceptors/correlation-id.interceptor.ts`
- `src/api/interceptors/audit.interceptor.ts`
- `src/api/filters/global-exception.filter.ts`
- `src/infrastructure/logger/logger.service.ts`
- `src/infrastructure/logger/logger.module.ts`
- `src/app.module.ts` (registrar pipes, filtros, interceptors globalmente)

**Dependencies:** TASK-010 (AuditService)
**Database impact:** Ninguno
**API impact:** Todos los endpoints reciben `X-Correlation-ID` en response
**Container impact:** Ninguno
**Security impact:** High — redaction de campos sensibles en logs. Stack traces no expuestos en prod.

**Acceptance criteria:**
- [ ] Todos los requests tienen `X-Correlation-ID` en el header de response
- [ ] Los logs en formato JSON incluyen `correlationId`, `tenantId`, `method`, `url`, `statusCode`, `durationMs`
- [ ] Campos `password`, `secret`, `token`, `credential`, `keyHash` son `[REDACTED]` en logs
- [ ] Errores de dominio mapean a sus códigos HTTP correctos
- [ ] Errores inesperados retornan 500 con `{ error: { code: "INTERNAL_ERROR", correlationId, timestamp } }` sin stack trace
- [ ] `console.log` directo está prohibido — solo usar el `LoggerService`

**Required tests:**
- Unit: `global-exception.filter.spec.ts` — mapeo de excepciones
- Unit: `correlation-id.interceptor.spec.ts` — genera UUID si no viene, propaga si viene
- E2E: verificar que el header `X-Correlation-ID` está en todos los responses

**Migration considerations:** N/A
**Rollback or mitigation:** Sin impacto en producción.
**Risk:** Medium

---

## TASK-012: API Infrastructure — Swagger, Health Checks, Versionado

**Status:** Proposed
**Priority:** High
**Domain:** Infrastructure / API
**Requirement:** Billing_Plan_Desarrollo.md — OpenAPI/Swagger, health checks, API versionada `/api/v1`.
**Reason:** Swagger documenta el contrato de la API. Health checks son necesarios para deployment en ECS/Docker.
**Current problem:** No existe documentación automática ni health checks.
**Proposed change:**
Configurar Swagger UI, health module y versionado global.

1. **Swagger**: `@nestjs/swagger`, disponible en `/api/docs` solo en no-producción (o con flag). Decorar todos los DTOs y controllers con decoradores de Swagger.
2. **Health**: `@nestjs/terminus`. Endpoints `/health`, `/health/ready` (verifica DB), `/health/live`.
3. **Versionado**: prefijo global `/api/v1` configurado en NestJS app.
4. **Helmet**: headers de seguridad HTTP.
5. **CORS**: configurado para permitir origins específicos (configurable).

**Affected files:**
- `src/api/health/health.controller.ts`
- `src/api/health/indicators/prisma.health-indicator.ts`
- `src/bootstrap/api.main.ts` (configuración de Swagger, Helmet, CORS, global prefix)

**Dependencies:** TASK-004, TASK-003
**Database impact:** Ninguno
**API impact:** Añade `/health`, `/health/ready`, `/health/live`, `/api/docs`
**Container impact:** HEALTHCHECK en Dockerfile usa `/health`
**Security impact:** Medium — Swagger debe estar deshabilitado en producción o protegido

**Acceptance criteria:**
- [ ] `GET /health` retorna `{ status: "ok" }` sin autenticación
- [ ] `GET /health/ready` retorna `{ status: "ok", db: "ok" }` cuando PostgreSQL responde
- [ ] `GET /health/ready` retorna 503 cuando PostgreSQL no responde
- [ ] `GET /api/docs` muestra Swagger UI con todos los endpoints documentados
- [ ] Todos los endpoints tienen prefijo `/api/v1`
- [ ] Respuestas de health no incluyen información sensible (no versión de BD, no connection string)

**Required tests:**
- Integration: `health.controller.spec.ts` — ready con DB OK, ready con DB KO
- E2E: `GET /health` y `GET /health/ready`

**Migration considerations:** N/A
**Rollback or mitigation:** Sin impacto en producción.
**Risk:** Low

---

## TASK-013: Job Queue Infrastructure — pg-boss + JobQueuePort + HaciendaPort

**Status:** Proposed
**Priority:** High
**Domain:** Infrastructure
**Requirement:** U-03 — pg-boss como queue, JobQueuePort abstraction. U-04 — HaciendaPort + MockHaciendaAdapter.
**Reason:** La infraestructura de queue debe estar lista antes de Fase 1. MockHaciendaAdapter permite desarrollo sin conectividad real a Hacienda.
**Current problem:** No existe infraestructura de queue ni abstracción de Hacienda.
**Proposed change:**
Implementar `JobQueuePort` con `PgBossJobQueue` y `InMemoryJobQueue`. Implementar `HaciendaPort` con `MockHaciendaAdapter`. Configurar el proceso worker.

**JobQueuePort:**
```typescript
interface JobQueuePort {
  publish<T extends object>(jobName: string, payload: T, options?: JobPublishOptions): Promise<void>;
  schedule<T extends object>(jobName: string, cron: string, payload: T): Promise<void>;
}

// PgBossJobQueue: usa pg-boss, conecta al mismo DATABASE_URL
// InMemoryJobQueue: para tests, almacena en memoria, ejecuta síncronamente
```

**HaciendaPort:**
```typescript
interface HaciendaPort {
  getTaxpayer(identification: string): Promise<TaxpayerResult>;
  getExchangeRate(currency: string, date: Date): Promise<ExchangeRateResult>;
  submitDocument(xml: string, accessToken: string): Promise<SubmissionResult>;
  getDocumentStatus(key: string, accessToken: string): Promise<DocumentStatusResult>;
}

// MockHaciendaAdapter: retorna fixtures pre-definidos
// Fixtures: contribuyente encontrado, no encontrado, timeout, accepted, rejected
```

**Worker entrypoint** (`worker.main.ts`): inicializa pg-boss, registra job handlers, sin HTTP server de negocio.

**Affected files:**
- `src/infrastructure/queue/ports/job-queue.port.ts`
- `src/infrastructure/queue/adapters/pgboss-job-queue.adapter.ts`
- `src/infrastructure/queue/adapters/in-memory-job-queue.adapter.ts`
- `src/infrastructure/queue/queue.module.ts`
- `src/infrastructure/integrations/hacienda/ports/hacienda.port.ts`
- `src/infrastructure/integrations/hacienda/adapters/hacienda-api.adapter.ts`
- `src/infrastructure/integrations/hacienda/adapters/mock-hacienda.adapter.ts`
- `src/infrastructure/integrations/hacienda/fixtures/`
- `src/infrastructure/integrations/hacienda/hacienda.module.ts`
- `src/workers/processors/` (vacío en Fase 0, estructura lista)
- `src/bootstrap/worker.main.ts` (actualizado con pg-boss init)

**Dependencies:** TASK-004
**Database impact:** pg-boss crea schema `pgboss` automáticamente (no requiere migración manual)
**API impact:** Ninguno directo
**Container impact:** billing-worker proceso usa el mismo DATABASE_URL
**Security impact:** Low — URLs de Hacienda solo en configuración de adaptadores, no en dominio

**Acceptance criteria:**
- [ ] `PgBossJobQueue.publish()` encola un job y pg-boss lo persiste en PostgreSQL
- [ ] `InMemoryJobQueue` ejecuta el handler de forma síncrona en tests
- [ ] `MockHaciendaAdapter` retorna fixture correcto para cada escenario sin conectividad real
- [ ] `worker.main.ts` arranca y conecta a pg-boss sin errores
- [ ] Fixtures de Hacienda incluyen: taxpayer found, not found, timeout, accepted, rejected
- [ ] Las URLs reales de Hacienda solo aparecen en `hacienda-api.adapter.ts` y en configuración

**Required tests:**
- Unit: `pgboss-job-queue.adapter.spec.ts` (con mock de pg-boss)
- Unit: `in-memory-job-queue.spec.ts` — publish + handler ejecutado síncronamente
- Unit: `mock-hacienda.adapter.spec.ts` — todos los fixtures retornan estructura correcta
- Smoke test: job de prueba encolado y procesado por el worker

**Migration considerations:** pg-boss crea sus propias tablas. No interferir con ellas.
**Rollback or mitigation:** Sin impacto en producción.
**Risk:** Medium

---

## TASK-014: Object Storage Abstraction — StoragePort

**Status:** Proposed
**Priority:** Medium
**Domain:** Infrastructure
**Requirement:** Billing_Plan_Desarrollo.md — Abstracción de Object Storage
**Reason:** La abstracción debe estar lista antes de Fase 5 (XML/PDF). Instanciarla en Fase 0 la hace disponible sin costo adicional.
**Current problem:** No existe abstracción de storage.
**Proposed change:**
Implementar `StoragePort` con `S3StorageAdapter` y `LocalStorageAdapter`.

```typescript
interface StoragePort {
  upload(key: string, content: Buffer, metadata?: Record<string, string>): Promise<string>;
  download(key: string): Promise<Buffer>;
  getSignedUrl(key: string, expiresInSeconds: number): Promise<string>;
  delete(key: string): Promise<void>;
}
// S3StorageAdapter: usa AWS SDK v3 (@aws-sdk/client-s3)
// LocalStorageAdapter: guarda en filesystem local para dev
```

**Affected files:**
- `src/infrastructure/storage/ports/storage.port.ts`
- `src/infrastructure/storage/adapters/s3-storage.adapter.ts`
- `src/infrastructure/storage/adapters/local-storage.adapter.ts`
- `src/infrastructure/storage/storage.module.ts`

**Dependencies:** TASK-003 (configuración de STORAGE_TYPE y S3 config)
**Database impact:** Ninguno
**API impact:** Ninguno
**Container impact:** LocalStack container para S3 local
**Security impact:** Medium — archivos privados, sin acceso público. Signed URLs para descarga autorizada.

**Acceptance criteria:**
- [ ] `LocalStorageAdapter` funciona sin LocalStack (solo filesystem local)
- [ ] `S3StorageAdapter` funciona con LocalStack en dev y con S3 real en prod
- [ ] `StoragePort` es seleccionado por `STORAGE_TYPE` env var
- [ ] Los archivos subidos no son públicamente accesibles (private by default)
- [ ] Signed URLs tienen TTL configurable

**Required tests:**
- Unit: `local-storage.adapter.spec.ts` — upload/download/delete en directorio temporal
- Integration (opcional): `s3-storage.adapter.integration.spec.ts` contra LocalStack

**Migration considerations:** N/A
**Rollback or mitigation:** Sin impacto en producción.
**Risk:** Low

---

## TASK-015: Secret Management — SecretProvider Abstraction

**Status:** Proposed
**Priority:** High
**Domain:** Infrastructure
**Requirement:** U-06 — AWS SSM Parameter Store + SecretProvider abstraction. Dev usa env vars.
**Reason:** Los secrets deben manejarse de forma consistente y segura desde el inicio.
**Current problem:** No existe abstracción de secret management.
**Proposed change:**
Implementar `SecretProvider` con `EnvSecretProvider` y `AwsParameterStoreSecretProvider`.

```typescript
interface SecretProvider {
  getSecret(key: string): Promise<string>;
}

// EnvSecretProvider: lee de process.env (desarrollo)
// AwsParameterStoreSecretProvider: lee de AWS SSM con SecureString + KMS (producción)
```

Selección automática basada en `SECRET_PROVIDER` env var:
- `env` → `EnvSecretProvider`
- `ssm` → `AwsParameterStoreSecretProvider`

El `JwtStrategy` (TASK-007) usa `SecretProvider.getSecret('JWT_SECRET')` en lugar de leer `process.env.JWT_SECRET` directamente.

**Affected files:**
- `src/infrastructure/secrets/ports/secret-provider.port.ts`
- `src/infrastructure/secrets/adapters/env-secret-provider.adapter.ts`
- `src/infrastructure/secrets/adapters/aws-parameter-store.adapter.ts`
- `src/infrastructure/secrets/secrets.module.ts`

**Dependencies:** TASK-003
**Database impact:** Ninguno
**API impact:** Ninguno
**Container impact:** IAM Role en ECS para acceso a SSM en producción
**Security impact:** Critical — secrets nunca en código. SSM SecureString + KMS. Least-privilege IAM.

**Acceptance criteria:**
- [ ] `EnvSecretProvider.getSecret('JWT_SECRET')` retorna el valor de `process.env.JWT_SECRET`
- [ ] `EnvSecretProvider` lanza si la variable no existe
- [ ] `AwsParameterStoreSecretProvider` obtiene el secret de SSM con decryption
- [ ] El secret nunca se loggea (ni siquiera en debug)
- [ ] La selección del provider es automática basada en `SECRET_PROVIDER` env var

**Required tests:**
- Unit: `env-secret-provider.spec.ts` — retorna valor, lanza si ausente
- Unit: `aws-parameter-store.adapter.spec.ts` — con mock de SSM client
- Integration (CI): env provider con variables de entorno de test

**Migration considerations:** N/A
**Rollback or mitigation:** Sin impacto en producción.
**Risk:** Medium

---

## TASK-016: Docker Configuration

**Status:** Proposed
**Priority:** High
**Domain:** Infrastructure / DevOps
**Requirement:** U-01 — Docker. Billing_Plan_Desarrollo.md — Docker.
**Reason:** El entorno reproducible de desarrollo local y producción requiere Docker.
**Current problem:** No existe configuración de Docker.
**Proposed change:**
Crear Dockerfile multi-stage y docker-compose completo.

`docker-compose.yml`:
- `billing-api` (puerto 3000)
- `billing-worker` (sin puerto HTTP de negocio)
- `postgres:15-alpine` con healthcheck
- `localstack:3` para S3 local

`Dockerfile` multi-stage:
- `deps`: `npm ci`
- `builder`: `npm run build` + `npm prune --production`
- `runner`: usuario non-root `billing`, HEALTHCHECK, CMD

Scripts de conveniencia:
```bash
# En package.json
"docker:up": "docker-compose up -d"
"docker:down": "docker-compose down"
"docker:logs": "docker-compose logs -f"
```

**Affected files:**
- `Dockerfile`
- `docker-compose.yml`
- `docker-compose.override.yml` (override local opcionales)
- `.dockerignore`
- `package.json` (scripts docker)

**Dependencies:** TASK-001
**Database impact:** PostgreSQL en docker-compose
**API impact:** billing-api en docker-compose en puerto 3000
**Container impact:** Imagen multi-stage, usuario non-root, HEALTHCHECK
**Security impact:** High — imagen non-root, sin secretos en Dockerfile, healthcheck funcional

**Acceptance criteria:**
- [ ] `docker-compose up` levanta todos los servicios sin errores
- [ ] Todos los contenedores están en estado `healthy`
- [ ] billing-api responde en `http://localhost:3000/health`
- [ ] billing-worker arranca y conecta a PostgreSQL
- [ ] La imagen runner no corre como root
- [ ] `.dockerignore` excluye: `node_modules`, `dist`, `.env*`, `*.p12`, `.git`
- [ ] No hay secretos hardcodeados en Dockerfile ni docker-compose

**Required tests:**
- Manual: `docker-compose up` → verificar todos los servicios healthy
- Manual: `docker-compose logs billing-api` → no hay errores de arranque

**Migration considerations:** N/A
**Rollback or mitigation:** Sin impacto en producción.
**Risk:** Low

---

## TASK-017: CI/CD — GitHub Actions

**Status:** Proposed
**Priority:** High
**Domain:** Infrastructure / DevOps
**Requirement:** U-07 — GitHub Actions + gates obligatorios (lint, typecheck, test, build, verify).
**Reason:** CI/CD automático previene regressions y garantiza calidad en cada PR.
**Current problem:** No existe pipeline de CI/CD.
**Proposed change:**
Crear pipeline de GitHub Actions con todos los gates requeridos.

Pipeline (`.github/workflows/ci.yml`):
```yaml
on: [push, pull_request]
jobs:
  quality:
    steps:
      - lint:      npm run lint
      - typecheck: npm run typecheck
      - test:      npm run test (con PostgreSQL como service)
      - build:     npm run build
  verify:
    needs: [quality]
    steps:
      - e2e:       npm run test:e2e (con PostgreSQL como service)
      - docker:    docker build --target runner .
```

Variables de CI (GitHub Secrets):
- `DATABASE_URL` para tests
- Ningún otro secret necesario en Fase 0

**Affected files:**
- `.github/workflows/ci.yml`
- `.github/workflows/release.yml` (opcional — para future deploys)

**Dependencies:** TASK-001
**Database impact:** PostgreSQL service container en CI para tests de integración
**API impact:** Ninguno
**Container impact:** Docker build verificado en CI
**Security impact:** Medium — GitHub Secrets para variables sensibles. No exponer DATABASE_URL en logs.

**Acceptance criteria:**
- [ ] El pipeline corre en cada push y PR
- [ ] Si `lint` falla, el pipeline falla y el PR no puede mergarse
- [ ] Si `typecheck` falla, el pipeline falla
- [ ] Si `test` falla, el pipeline falla
- [ ] Si `build` falla, el pipeline falla
- [ ] El pipeline usa caching de `node_modules` para acelerar builds
- [ ] PostgreSQL está disponible como service container en CI
- [ ] La arquitectura de los scripts no depende de GitHub Actions (los scripts corren localmente también)

**Required tests:**
- El pipeline en sí es el test. Verde = correcto.

**Migration considerations:** N/A
**Rollback or mitigation:** Revertir `.github/workflows/ci.yml`.
**Risk:** Low

---

## TASK-018: Tests — Cobertura Completa de Fase 0

**Status:** Proposed
**Priority:** High
**Domain:** All
**Requirement:** Billing_Plan_Desarrollo.md — Calidad. U-01 a U-10 — tests de todas las invariantes.
**Reason:** Los tests son la red de seguridad principal. Sin tests, los refactors futuros son riesgosos.
**Current problem:** No existen tests.
**Proposed change:**
Completar la cobertura de tests para todos los módulos de Fase 0. Las tareas TASK-006 a TASK-015 incluyen sus propios tests, pero esta tarea cubre los tests E2E de integración end-to-end y los tests de aislamiento cross-módulo.

Tests E2E adicionales:
1. **Tenant isolation**: crear 2 tenants con datos distintos, verificar que el tenant A no ve datos del B
2. **API Key lifecycle**: crear → listar (sin secret) → usar (auth) → revocar → intentar usar (401)
3. **Auth flow**: login → access token → refresh → nuevo access token
4. **Audit completeness**: verificar que cada operación genera al menos un registro en `audit_logs`
5. **Correlation ID propagation**: verificar que el `X-Correlation-ID` del request aparece en el response y en `audit_logs`

Setup de tests:
- `test/setup.ts`: crear tablas de test, limpiar entre tests
- `test/helpers/`: factories para crear tenants, users, companies, api-keys en tests

**Affected files:**
- `test/e2e/tenants.e2e-spec.ts`
- `test/e2e/auth.e2e-spec.ts`
- `test/e2e/companies.e2e-spec.ts`
- `test/e2e/api-keys.e2e-spec.ts`
- `test/e2e/audit.e2e-spec.ts`
- `test/e2e/tenant-isolation.e2e-spec.ts`
- `test/helpers/entity-factories.ts`
- `test/setup.ts`

**Dependencies:** TASK-006 a TASK-015
**Database impact:** Base de datos de test separada (o mismo server, diferente DB)
**API impact:** Ninguno
**Container impact:** Ninguno
**Security impact:** Medium — los tests de aislamiento de tenant son críticos para validar la seguridad

**Acceptance criteria:**
- [ ] `npm run test` — 0 failures en tests unitarios y de aplicación
- [ ] `npm run test:e2e` — 0 failures en tests E2E
- [ ] Test de tenant isolation pasa: tenant A no puede ver datos de tenant B
- [ ] Test de audit completeness pasa: cada operación CRUD genera al menos 1 registro en audit_logs
- [ ] Cobertura de domain layer > 90%
- [ ] Cobertura de application layer > 80%

**Required tests:** Los tests son la entrega de esta tarea.

**Migration considerations:** Base de datos de test se limpia antes/después de cada test E2E.
**Rollback or mitigation:** Sin impacto en producción.
**Risk:** Medium

---

## TASK-019: Documentación Final y Verificación de Arquitectura

**Status:** Proposed
**Priority:** Medium
**Domain:** All
**Requirement:** Billing_Plan_Desarrollo.md — Arquitectura correctamente documentada.
**Reason:** La documentación actualizada es esencial para incorporar nuevos desarrolladores y para las fases siguientes.
**Current problem:** docs/current-state.md refleja el estado pre-implementación.
**Proposed change:**
Actualizar toda la documentación para reflejar la implementación real de Fase 0.

1. **`docs/current-state.md`**: actualizar con la implementación real — módulos implementados, API endpoints reales, schema real, tests implementados.
2. **`docs/architecture.md`**: verificar que el documento coincide con el código implementado. Corregir cualquier desviación.
3. **`docs/action-plan.md`**: marcar Stage 0.x como completados. Mover estado a "Completado".
4. **`docs/tasks.md`**: actualizar estado de cada TASK a "Completed".
5. **`README.md`**: instrucciones de setup completas, comandos útiles, link a Swagger, link a architecture.md.
6. **Verificación de cumplimiento arquitectónico**:
   - Revisar que ningún archivo en `domain/` importa Prisma, NestJS ni frameworks
   - Verificar que los controllers no contienen lógica de negocio
   - Verificar que todos los repositories filtran por `tenantId`
   - Verificar que no hay secrets hardcodeados en el código

**Affected files:**
- `docs/current-state.md` (actualizar)
- `docs/architecture.md` (verificar y corregir si hay desviaciones)
- `docs/action-plan.md` (actualizar estados)
- `docs/tasks.md` (marcar completadas)
- `README.md` (completar)

**Dependencies:** TASK-001 a TASK-018
**Database impact:** Ninguno
**API impact:** Ninguno
**Container impact:** Ninguno
**Security impact:** Ninguno

**Acceptance criteria:**
- [ ] Validación manual V-01 a V-20 de action-plan.md completada exitosamente
- [ ] `docs/current-state.md` describe la implementación real (no futura)
- [ ] `docs/architecture.md` coincide con el código real
- [ ] Ningún archivo en `*/domain/**` importa `@prisma/client`, `@nestjs/*` u otros frameworks
- [ ] `README.md` tiene instrucciones suficientes para que un nuevo desarrollador levante el entorno
- [ ] No hay `TODO` críticos sin resolver relacionados con seguridad o invariantes de negocio

**Required tests:**
- Todos los tests de TASK-018 deben pasar como verificación final.

**Migration considerations:** N/A
**Rollback or mitigation:** Sin impacto en producción.
**Risk:** Low
