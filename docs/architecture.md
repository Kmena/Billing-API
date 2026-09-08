# Architecture — Billing

> **Versión:** 2.0
> **Fecha:** 2025
> **Estado:** Decisiones U-01 a U-10 aprobadas y activas — Fase 0 Foundation
> **Propietario:** hdd-architecture-agent-e257ee
> **ADRs:** Ver `docs/adr/` para registros de decisión individuales (ADR-001 a ADR-010)

---

## 1. Purpose and Scope

Este documento establece la arquitectura activa que gobierna la construcción de **Billing** como un Monolito Modular con Arquitectura Hexagonal sobre Node.js / TypeScript.

Todas las decisiones arquitectónicas U-01 a U-10 han sido revisadas y aprobadas por el equipo. Este documento refleja el estado activo de esas decisiones. Las secciones marcadas con `[DECISIÓN PENDIENTE]` han sido eliminadas — no quedan decisiones pendientes de esta ronda.

**Cubre:**
- Estilo arquitectónico y separación de capas
- Estructura de módulos de dominio
- Ports & Adapters definidos y sus implementaciones
- Reglas de dependencia entre capas
- Modelo de datos de Fase 0 (Prisma schema)
- Contratos de API de Fase 0
- Seguridad y multi-tenancy
- Contenedores y deployment
- Estrategia de testing

**No cubre (Fases futuras):**
- Integración con Hacienda / consulta de contribuyentes (Fase 1+)
- Conexión de empresa a Hacienda / credenciales fiscales (Fase 2+)
- Generación de XML y firma XAdES (Fase 3+)
- Procesamiento asíncrono de documentos fiscales (Fase 4+)
- UI administrativa (Fase 8+)

La visión de arquitectura completa (todas las fases) se documenta en `docs/future-architecture.md`.

---

## 2. Current Active Architecture Summary

**Billing** se construye como un **Monolito Modular con Arquitectura Hexagonal** sobre Node.js / TypeScript.

### 2.1 Stack de tecnología

| Decisión | Valor confirmado | ADR |
|---|---|---|
| Estilo arquitectónico | Monolito Modular | ADR-001 |
| Patrón interno | Hexagonal Architecture (Ports & Adapters) | ADR-001 |
| Runtime | Node.js LTS (v20+) | ADR-001 |
| Lenguaje | TypeScript — strict mode | ADR-001 |
| Framework HTTP | NestJS | ADR-001 |
| Validación HTTP | class-validator + class-transformer | ADR-001 |
| API Docs | @nestjs/swagger (OpenAPI 3.1) | — |
| ORM / Migrations | Prisma | ADR-002 |
| Base de datos | PostgreSQL 15+ | ADR-002 |
| Multi-tenancy | Row-level (`tenant_id` en todas las tablas) | ADR-002 |
| Tenant context | AsyncLocalStorage | ADR-002 |
| Hashing passwords y API Keys | argon2id | ADR-002 |
| Queue / Jobs asíncronos | pg-boss (PostgreSQL) | ADR-003 |
| Object Storage | AWS S3 (prod) / LocalStack o MinIO (dev) | — |
| Secret Management | AWS SSM Parameter Store + KMS (prod) / env vars (dev) | ADR-006 |
| Logging | Pino (JSON estructurado) | — |
| Testing | Jest + Supertest | — |
| CI/CD | GitHub Actions | ADR-007 |
| Containerización | Docker multi-stage, imagen runner non-root | — |

> **⚠️ Redis NO es parte de la infraestructura.** La queue usa pg-boss sobre el mismo PostgreSQL. No se introduce infraestructura adicional sin necesidad demostrada. (ADR-003)

### 2.2 Ports & Adapters activos

| Port (Interface) | Adapter producción | Adapter desarrollo/tests | ADR |
|---|---|---|---|
| `JobQueuePort` | `PgBossJobQueue` | `InMemoryJobQueue` | ADR-003 |
| `SecretProvider` | `AwsParameterStoreSecretProvider` | `EnvSecretProvider` | ADR-006 |
| `HaciendaPort` | `HaciendaApiAdapter` | `MockHaciendaAdapter` | ADR-004 |
| `StoragePort` | `S3StorageAdapter` | `LocalStorageAdapter` | — |
| `XmlSignerPort` | ⚠️ TBD — Technical Spike | — | ADR-005 |

### 2.3 Diagrama de runtime

```
External Systems (Inventori, POS, ERP, E-commerce)
              │
              │ REST API (HTTP + API Key / JWT)
              ▼
    ┌──────────────────┐
    │   Billing API    │  ← billing-api process (port 3000)
    │   (NestJS HTTP)  │
    └────────┬─────────┘
             │ publica jobs via JobQueuePort (pg-boss)
             ▼
    ┌──────────────────┐
    │ Billing Worker   │  ← billing-worker process (background)
    │  (pg-boss jobs)  │
    └────────┬─────────┘
             │
    ┌────────┴──────────────────────────┐
    │                                   │
    ▼                                   ▼
PostgreSQL (RDS)                 Object Storage (S3)
  ├── Datos de aplicación          ├── XML firmados
  └── pg-boss queue (schema pgboss) ├── PDFs
                                   └── Respuestas Hacienda

                     AWS SSM Parameter Store
                       ├── DATABASE_URL
                       ├── JWT_SECRET
                       └── otros secrets
```

---

## 3. Active Architectural Style and Module Boundaries

### 3.1 Hexagonal Architecture Mapping

```
┌─────────────────────────────────────────────────────────────┐
│                    INPUT ADAPTERS                           │
│  NestJS Controllers │ Guards │ Interceptors │ Pipes        │
│  (modules/{mod}/infrastructure/http/)                       │
└────────────────────────────┬────────────────────────────────┘
                             │ Use Case Interfaces (Input Ports)
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                   APPLICATION LAYER                         │
│  Use Case Handlers (Commands / Queries)                     │
│  Application Services │ DTOs │ Port Interfaces              │
│  Transaction Orchestration │ Event Orchestration            │
└────────────────────────────┬────────────────────────────────┘
                             │ Domain calls
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                     DOMAIN LAYER                            │
│  Entities │ Aggregates │ Value Objects                      │
│  Domain Services │ Domain Events │ Domain Exceptions        │
│  Repository Interfaces (Output Ports)                       │
│                                                             │
│  ⛔ SIN dependencias de frameworks, ORMs, ni infra         │
└────────────────────────────┬────────────────────────────────┘
                             │ Output Ports
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                   OUTPUT ADAPTERS                           │
│  Prisma Repositories │ S3StorageAdapter │ PgBossJobQueue   │
│  AwsParameterStoreSecretProvider │ HaciendaApiAdapter      │
│  MockHaciendaAdapter │ LocalStorageAdapter                  │
│  (infrastructure/persistence, infrastructure/queue, ...)    │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Port Interfaces Definitions

```typescript
// ─── QUEUE PORT ─────────────────────────────────────────────
// src/infrastructure/queue/ports/job-queue.port.ts
interface JobQueuePort {
  publish<T extends object>(
    jobName: string,
    payload: T,
    options?: JobPublishOptions,
  ): Promise<void>;
  schedule<T extends object>(
    jobName: string,
    cronExpression: string,
    payload: T,
  ): Promise<void>;
}
// Implementations: PgBossJobQueue | BullMQJobQueue | SqsJobQueue | InMemoryJobQueue

// ─── SECRET PROVIDER PORT ───────────────────────────────────
// src/infrastructure/secrets/ports/secret-provider.port.ts
interface SecretProvider {
  getSecret(key: string): Promise<string>;
}
// Implementations: EnvSecretProvider | AwsParameterStoreSecretProvider

// ─── HACIENDA PORT ──────────────────────────────────────────
// src/infrastructure/integrations/hacienda/ports/hacienda.port.ts
interface HaciendaPort {
  getTaxpayer(identification: string): Promise<TaxpayerResult>;
  getExchangeRate(currency: string, date: Date): Promise<ExchangeRateResult>;
  submitDocument(xmlPayload: string, accessToken: string): Promise<SubmissionResult>;
  getDocumentStatus(key: string, accessToken: string): Promise<DocumentStatusResult>;
}
// Implementations: HaciendaApiAdapter | MockHaciendaAdapter

// ─── STORAGE PORT ───────────────────────────────────────────
// src/infrastructure/storage/ports/storage.port.ts
interface StoragePort {
  upload(key: string, content: Buffer, metadata?: Record<string, string>): Promise<string>;
  download(key: string): Promise<Buffer>;
  getSignedUrl(key: string, expiresInSeconds: number): Promise<string>;
  delete(key: string): Promise<void>;
}
// Implementations: S3StorageAdapter | LocalStorageAdapter

// ─── XML SIGNER PORT ────────────────────────────────────────
// src/infrastructure/signing/ports/xml-signer.port.ts
// ⚠️ TECHNICAL SPIKE PENDIENTE — No comprometerse a implementación (ADR-005)
interface XmlSignerPort {
  sign(xmlDocument: string, certificate: Pkcs12Certificate): Promise<string>;
  verify(signedXml: string): Promise<SignatureVerificationResult>;
}
```

### 3.3 Estructura de directorios del proyecto

```
src/
├── bootstrap/
│   ├── api.main.ts          ← entrypoint billing-api
│   └── worker.main.ts       ← entrypoint billing-worker
│
├── modules/
│   ├── identity/            ← Tenant, User, Auth (Core)
│   │   ├── domain/
│   │   │   ├── entities/
│   │   │   ├── value-objects/
│   │   │   ├── events/
│   │   │   ├── exceptions/
│   │   │   └── ports/       ← IUserRepository, ITenantRepository
│   │   ├── application/
│   │   │   └── use-cases/
│   │   │       ├── create-tenant/
│   │   │       ├── create-user/
│   │   │       ├── login/
│   │   │       └── refresh-token/
│   │   ├── infrastructure/
│   │   │   ├── persistence/  ← PrismaTenantRepository, PrismaUserRepository
│   │   │   └── http/         ← TenantController, AuthController + DTOs
│   │   └── identity.module.ts
│   │
│   ├── companies/           ← Company (Core)
│   │   ├── domain/
│   │   ├── application/
│   │   ├── infrastructure/
│   │   └── companies.module.ts
│   │
│   ├── api-keys/            ← ApiKey (Core)
│   │   ├── domain/
│   │   ├── application/
│   │   ├── infrastructure/
│   │   └── api-keys.module.ts
│   │
│   ├── audit/               ← AuditLog (Generic)
│   │   ├── domain/
│   │   ├── application/
│   │   ├── infrastructure/
│   │   └── audit.module.ts
│   │
│   └── shared/              ← Domain kernel técnico
│       ├── domain/
│       │   ├── base-entity.ts
│       │   ├── base-aggregate.ts
│       │   ├── base-value-object.ts
│       │   ├── domain-event.ts
│       │   └── domain-exception.ts
│       └── shared.module.ts
│
├── infrastructure/
│   ├── database/
│   │   ├── prisma.service.ts
│   │   └── database.module.ts
│   ├── queue/
│   │   ├── ports/job-queue.port.ts
│   │   ├── adapters/
│   │   │   ├── pgboss-job-queue.adapter.ts
│   │   │   └── in-memory-job-queue.adapter.ts
│   │   └── queue.module.ts
│   ├── secrets/
│   │   ├── ports/secret-provider.port.ts
│   │   ├── adapters/
│   │   │   ├── env-secret-provider.adapter.ts
│   │   │   └── aws-parameter-store.adapter.ts
│   │   └── secrets.module.ts
│   ├── storage/
│   │   ├── ports/storage.port.ts
│   │   ├── adapters/
│   │   │   ├── s3-storage.adapter.ts
│   │   │   └── local-storage.adapter.ts
│   │   └── storage.module.ts
│   └── integrations/
│       └── hacienda/
│           ├── ports/hacienda.port.ts
│           ├── adapters/
│           │   ├── hacienda-api.adapter.ts
│           │   └── mock-hacienda.adapter.ts
│           └── hacienda.module.ts
│
├── api/
│   ├── guards/
│   │   ├── jwt-auth.guard.ts
│   │   └── api-key-auth.guard.ts
│   ├── interceptors/
│   │   ├── correlation-id.interceptor.ts
│   │   └── audit.interceptor.ts
│   ├── filters/
│   │   └── global-exception.filter.ts
│   ├── pipes/
│   │   └── validation.pipe.ts
│   └── health/
│       └── health.controller.ts
│
└── workers/
    └── processors/
        └── (job handlers — vacío en Fase 0)

prisma/
├── schema.prisma
└── migrations/
    └── 20250001_initial_foundation/

test/
└── e2e/

.github/
└── workflows/
    └── ci.yml
```

### 3.4 Reglas de comunicación cross-módulo

Un módulo de dominio **nunca importa directamente** de otro módulo de dominio. La comunicación cross-módulo ocurre exclusivamente a través de:

1. **IDs** — referencias débiles entre agregados (companyId en ApiKey, no Company directamente)
2. **Eventos de dominio** — publicados a través del EventBus cuando la operación ya fue confirmada
3. **Application Services públicos** — expuestos como puertos del módulo (no las entities internas)

---

## 4. Current Domain Map

### Fase 0 — Módulos activos

```
┌──────────────────────────────────────────────────────┐
│                  BILLING MONOLITH                    │
│                                                      │
│  ┌─────────────────┐    ┌──────────────────┐         │
│  │    identity     │    │    companies     │         │
│  │    (Core)       │◄───│    (Core)        │         │
│  │                 │    │                  │         │
│  │  Tenant (root)  │    │  Company (root)  │         │
│  │  User           │    │                  │         │
│  │  Auth           │    │                  │         │
│  └────────┬────────┘    └────────┬─────────┘         │
│           │                     │                    │
│           ▼                     ▼                    │
│  ┌──────────────────────────────────────┐            │
│  │             api-keys                 │            │
│  │             (Core)                   │            │
│  │  ApiKey (root)                       │            │
│  │  → tenantId (ref)                    │            │
│  │  → companyId[] (ref via ApiKeyCompany)│            │
│  └──────────────────┬───────────────────┘            │
│                     │                                │
│                     ▼                                │
│  ┌──────────────────────────────────────┐            │
│  │              audit                   │            │
│  │           (Generic)                  │            │
│  │  AuditLog — append-only              │            │
│  │  Consumido por todos los módulos     │            │
│  └──────────────────────────────────────┘            │
│                                                      │
│  ┌──────────────────────────────────────┐            │
│  │              shared                  │            │
│  │  Domain kernel técnico               │            │
│  │  Base clases, interfaces comunes     │            │
│  └──────────────────────────────────────┘            │
└──────────────────────────────────────────────────────┘
```

### Clasificación de subdominios

| Módulo | Tipo | Justificación |
|---|---|---|
| identity | Core | Tenant y User son el núcleo del SaaS multi-tenant. Sin esto no hay producto. |
| companies | Core | Company es el actor principal del sistema fiscal. Cada documento pertenece a una Company. |
| api-keys | Core | Habilitador del modelo API-first y del acceso de sistemas externos. |
| audit | Generic | Capacidad transversal reutilizable. No contiene lógica de negocio propia. |
| shared | N/A | Kernel técnico. No es un dominio de negocio. |

### Módulos de Fases posteriores (no activos aún)

| Módulo | Fase | Tipo |
|---|---|---|
| taxpayers | 1 | Supporting |
| cabys | 1 | Supporting |
| tax | 1–3 | Core |
| fiscal-documents | 3 | Core |
| purchases | 6 | Core |
| payments | 7 | Core |
| documents | 5 | Supporting |
| notifications | 5 | Generic |
| webhooks | 4 | Supporting |

---

## 5. Current Runtime Components and Responsibilities

### billing-api

- Proceso HTTP que escucha en puerto configurable (default `3000`)
- Carga: todos los módulos de dominio + sus controllers
- Responsabilidades: autenticación, autorización, validación de input, orquestación de use cases, respuesta HTTP
- **No ejecuta jobs de background directamente**
- Encola jobs via `JobQueuePort` (pg-boss) para operaciones asíncronas

### billing-worker

- Proceso de jobs asíncronos — sin puerto HTTP de negocio
- Carga: todos los módulos de dominio + sus job processors/handlers
- Responsabilidades: procesar jobs de la queue, integración con servicios externos, retries con backoff
- Puede exponer un endpoint `/health` en puerto separado para monitoreo de proceso
- **No expone endpoints de negocio**

### Entrypoints

```
src/bootstrap/api.main.ts     → billing-api   (NestJS HTTP)
src/bootstrap/worker.main.ts  → billing-worker (pg-boss jobs)
```

Ambos importan los mismos módulos de dominio. Cada uno carga únicamente los adaptadores de transporte que le corresponden (HTTP controllers vs. job processors).

### Shared Infrastructure

```
PostgreSQL
  ├── Datos de aplicación (tenants, companies, users, api_keys, audit_logs)
  └── Queue state (schema pgboss — gestionado por pg-boss internamente)

Object Storage (S3 / LocalStack)
  └── Archivos fiscales (XML, PDF, respuestas Hacienda) — Fase 5+

AWS SSM Parameter Store (solo producción)
  └── Secrets: DATABASE_URL, JWT_SECRET, email creds, etc.
```

> **No hay Redis.** La queue se resuelve sobre PostgreSQL via pg-boss. No se añade ninguna infraestructura sin una necesidad técnica demostrada. (ADR-003)

---

## 6. Current Dependency Rules

### 6.1 Dirección de dependencias permitida

```
Input Adapter (Controller)
        │
        ▼ Input Port (Use Case interface)
Application Use Case Handler
        │
        ▼ Domain calls
Domain Entity / Aggregate / Service
        │
        ▼ Output Port (Repository / Service interface)
Output Adapter (Prisma Repo / HTTP Client / Queue / etc.)
```

### 6.2 Prohibiciones absolutas

| # | Prohibición | Razón |
|---|---|---|
| D-01 | El dominio no importa `NestJS`, `Prisma`, `pg-boss`, ni cualquier otro framework | El dominio debe ser 100% framework-agnostic y testeable con Jest puro sin mocks de infra |
| D-02 | Los controllers no contienen lógica de negocio | Los controllers solo traducen HTTP ↔ Use Cases |
| D-03 | Los repositorios no toman decisiones de negocio | Solo persisten y recuperan datos; aplican invariantes de query (tenant filter), no reglas de dominio |
| D-04 | Los Prisma models NO se usan como domain entities | Son contratos de persistencia. Las domain entities son clases TypeScript puras. Mapping explícito en el adapter. |
| D-05 | Un módulo no importa entities internas de otro módulo | Solo IDs (strings/UUIDs) o contratos públicos expuestos explícitamente |
| D-06 | Las excepciones de infraestructura no se filtran al dominio | Se mapean en los adapters antes de llegar a la capa de aplicación |
| D-07 | Los DTOs de API no se usan como domain entities | Separación estricta de contratos de presentación y modelos de dominio |
| D-08 | No circular dependencies entre módulos NestJS | Detectado en runtime por NestJS; también por lint rule |
| D-09 | Los job handlers del worker no bypasan la capa de aplicación | Los job handlers llaman a Use Cases, no a repositorios directamente |
| D-10 | `JobQueuePort` no se importa en la capa de dominio | La publicación de jobs ocurre en la capa de aplicación |

### 6.3 Flujo de una request HTTP completa

```
HTTP Request
    │
    ▼
[Guard: JwtAuthGuard | ApiKeyAuthGuard]
    │  verifica token/key, extrae tenantId + actor + scopes
    │  establece TenantContext en AsyncLocalStorage
    ▼
[Interceptor: CorrelationIdInterceptor]
    │  genera o propaga X-Correlation-ID
    ▼
[Interceptor: AuditInterceptor]  ← registra inicio
    │
    ▼
[Pipe: ValidationPipe]
    │  whitelist=true, valida y transforma DTO
    ▼
[Controller]
    │  construye Command o Query
    ▼
[Use Case Handler]
    │  orquesta domain + ports
    ▼
[Domain Entity / Aggregate]
    │  ejecuta reglas de negocio, produce eventos
    ▼
[Repository Port] ← implementado por [Prisma Adapter]
    │  WHERE tenant_id = ctx.tenantId  (siempre)
    ▼
[Use Case Handler]
    │  mapea a Response DTO
    ▼
[Controller]
    │  retorna HTTP response
    ▼
[Interceptor: AuditInterceptor]  ← completa audit entry (status, duration)
    │
    ▼
HTTP Response
```

---

## 7. Current Database Ownership and Transaction Boundaries

### 7.1 Estrategia de Multi-tenancy

**Row-level tenancy**: columna `tenant_id UUID NOT NULL` en todas las tablas tenant-aware.

**TenantContext** propagado via `AsyncLocalStorage`:

```
Guard extrae tenantId
  → AsyncLocalStorage.run({ tenantId }, requestHandler)
    → Repository.find(...) lee tenantId del contexto
      → Prisma: WHERE tenant_id = $tenantId en cada query
```

PostgreSQL Row-Level Security (RLS) puede activarse como capa adicional en el futuro sin cambiar la lógica de aplicación.

### 7.2 Schema de Fase 0 (Prisma)

```prisma
// ─── ENUMS ──────────────────────────────────────────────────
enum TenantStatus   { ACTIVE SUSPENDED CANCELLED }
enum TenantPlan     { TRIAL STARTER PROFESSIONAL ENTERPRISE }
enum UserStatus     { ACTIVE INACTIVE PENDING_VERIFICATION }
enum UserRole       { TENANT_ADMIN MEMBER READ_ONLY }
enum CompanyStatus  { ACTIVE INACTIVE }
enum IdentificationType {
  FISICA    // 01 – Cédula física (CR)
  JURIDICA  // 02 – Cédula jurídica (CR)
  DIMEX     // 03 – DIMEX (extranjeros residentes)
  NITE      // 04 – NITE
}
enum ApiKeyStatus  { ACTIVE REVOKED EXPIRED }
enum ApiKeyEnv     { LIVE TEST }

// ─── TENANT ─────────────────────────────────────────────────
model Tenant {
  id        String       @id @default(uuid()) @db.Uuid
  name      String       @db.VarChar(255)
  slug      String       @unique @db.VarChar(100)
  status    TenantStatus @default(ACTIVE)
  plan      TenantPlan   @default(TRIAL)
  metadata  Json?
  createdAt DateTime     @default(now()) @map("created_at")
  updatedAt DateTime     @updatedAt @map("updated_at")
  companies Company[]
  users     User[]
  apiKeys   ApiKey[]
  auditLogs AuditLog[]
  @@map("tenants")
}

// ─── COMPANY ────────────────────────────────────────────────
model Company {
  id                   String             @id @default(uuid()) @db.Uuid
  tenantId             String             @db.Uuid @map("tenant_id")
  legalName            String             @db.VarChar(255) @map("legal_name")
  tradeName            String?            @db.VarChar(255) @map("trade_name")
  identificationType   IdentificationType @map("identification_type")
  identificationNumber String             @db.VarChar(20) @map("identification_number")
  status               CompanyStatus      @default(ACTIVE)
  createdAt            DateTime           @default(now()) @map("created_at")
  updatedAt            DateTime           @updatedAt @map("updated_at")
  tenant               Tenant             @relation(fields: [tenantId], references: [id])
  authorizedApiKeys    ApiKeyCompany[]
  @@unique([tenantId, identificationNumber])
  @@index([tenantId, status])
  @@map("companies")
}

// ─── USER ───────────────────────────────────────────────────
model User {
  id           String     @id @default(uuid()) @db.Uuid
  tenantId     String     @db.Uuid @map("tenant_id")
  email        String     @db.VarChar(255)
  passwordHash String     @map("password_hash") @db.VarChar(255)
  firstName    String?    @db.VarChar(100) @map("first_name")
  lastName     String?    @db.VarChar(100) @map("last_name")
  role         UserRole   @default(MEMBER)
  status       UserStatus @default(ACTIVE)
  lastLoginAt  DateTime?  @map("last_login_at")
  createdAt    DateTime   @default(now()) @map("created_at")
  updatedAt    DateTime   @updatedAt @map("updated_at")
  tenant       Tenant     @relation(fields: [tenantId], references: [id])
  @@unique([tenantId, email])
  @@index([tenantId, status])
  @@map("users")
}

// ─── API KEY ────────────────────────────────────────────────
model ApiKey {
  id          String       @id @default(uuid()) @db.Uuid
  tenantId    String       @db.Uuid @map("tenant_id")
  name        String       @db.VarChar(255)
  environment ApiKeyEnv    @default(LIVE) @map("environment")
  keyPrefix   String       @unique @db.VarChar(16) @map("key_prefix")
  keyHash     String       @db.VarChar(255) @map("key_hash")
  scopes      String[]
  status      ApiKeyStatus @default(ACTIVE)
  expiresAt   DateTime?    @map("expires_at")
  lastUsedAt  DateTime?    @map("last_used_at")
  revokedAt   DateTime?    @map("revoked_at")
  revokedBy   String?      @db.Uuid @map("revoked_by")
  createdAt   DateTime     @default(now()) @map("created_at")
  updatedAt   DateTime     @updatedAt @map("updated_at")
  tenant      Tenant       @relation(fields: [tenantId], references: [id])
  companies   ApiKeyCompany[]
  auditLogs   AuditLog[]
  @@index([tenantId, status])
  @@index([keyPrefix])
  @@map("api_keys")
}

// ─── API KEY ↔ COMPANY (N:M) ───────────────────────────────
model ApiKeyCompany {
  apiKeyId  String  @db.Uuid @map("api_key_id")
  companyId String  @db.Uuid @map("company_id")
  apiKey    ApiKey  @relation(fields: [apiKeyId], references: [id])
  company   Company @relation(fields: [companyId], references: [id])
  @@id([apiKeyId, companyId])
  @@map("api_key_companies")
}

// ─── AUDIT LOG ──────────────────────────────────────────────
// append-only: sin UPDATE ni DELETE
model AuditLog {
  id            String   @id @default(uuid()) @db.Uuid
  tenantId      String?  @db.Uuid @map("tenant_id")
  companyId     String?  @db.Uuid @map("company_id")
  apiKeyId      String?  @db.Uuid @map("api_key_id")
  actor         String?  @db.VarChar(255)   // userId | apiKeyPrefix | "system"
  action        String   @db.VarChar(255)   // "api-key.created" | "user.login"
  resource      String?  @db.VarChar(255)   // "ApiKey:uuid" | "Tenant:uuid"
  endpoint      String?  @db.VarChar(500)
  httpMethod    String?  @db.VarChar(10) @map("http_method")
  statusCode    Int?     @map("status_code")
  ipAddress     String?  @db.VarChar(45) @map("ip_address")
  correlationId String?  @db.VarChar(36) @map("correlation_id")
  durationMs    Int?     @map("duration_ms")
  metadata      Json?
  errorMessage  String?  @map("error_message")
  createdAt     DateTime @default(now()) @map("created_at")
  tenant        Tenant?  @relation(fields: [tenantId], references: [id])
  apiKey        ApiKey?  @relation(fields: [apiKeyId], references: [id])
  @@index([tenantId, createdAt(sort: Desc)])
  @@index([correlationId])
  @@index([apiKeyId, createdAt(sort: Desc)])
  @@index([action, createdAt(sort: Desc)])
  @@map("audit_logs")
}
```

> **Nota sobre pg-boss:** pg-boss crea y gestiona sus propias tablas en el schema `pgboss` de PostgreSQL automáticamente al inicializar. No se requiere ninguna migración de aplicación para la infraestructura de queue. Si se necesita tracking de jobs a nivel de negocio, se añadirá una tabla separada en fases posteriores.

### 7.3 Transaction Boundaries

| Operación | Boundary | Justificación |
|---|---|---|
| Crear Tenant | Single transaction | Atómica, un solo agregado |
| Crear Company | Single transaction | Atómica, un solo agregado |
| Crear ApiKey | Single transaction (api_keys + api_key_companies) | Ambas tablas deben ser consistentes |
| Revocar ApiKey | Single transaction (api_keys) | Atómica |
| Audit log | Fire-and-forget (transaction separada) | No debe bloquear la respuesta principal |
| Publicar job en pg-boss | Puede coordinarse con la transacción principal | Evitar perder jobs si el commit falla (outbox pattern si necesario) |

### 7.4 Reglas de integridad

- Todos los UUIDs se generan en la aplicación (no `SERIAL` ni secuencias de BD) para predictabilidad en tests.
- `created_at` es inmutable después de la creación — nunca se actualiza.
- `audit_logs` es **append-only** — sin `UPDATE` ni `DELETE` por diseño. La política de retención se configura via Object Storage lifecycle o particionamiento futuro.
- Soft-delete solo donde el negocio lo requiera explícitamente. Fase 0: no se usa.

---

## 8. Current API and Integration Contracts

### 8.1 API Base

- Prefijo global: `/api/v1`
- Formato de respuesta: `application/json` siempre
- API documentada automáticamente en `/api/docs` (Swagger UI)
- Contratos propios de Billing — nunca se filtran contratos internos de Hacienda

### 8.2 Endpoints de Fase 0

```
# Health (sin autenticación)
GET  /health           → liveness
GET  /health/ready     → readiness (verifica DB)
GET  /health/live      → liveness alias

# Autenticación — usuarios administradores (JWT)
POST   /api/v1/auth/login          → { accessToken, refreshToken }
POST   /api/v1/auth/refresh        → { accessToken, refreshToken }

# Tenants — solo admin interno (JWT + role SUPER_ADMIN o sistema interno)
POST   /api/v1/tenants             → 201 { id, slug, name, status }
GET    /api/v1/tenants/{id}        → 200 { id, slug, name, status, plan }

# Companies — tenant admin (JWT + role TENANT_ADMIN)
POST   /api/v1/companies           → 201 { id, legalName, status }
GET    /api/v1/companies/{id}      → 200 { id, legalName, tradeName, ... }

# API Keys — tenant admin (JWT + role TENANT_ADMIN)
POST   /api/v1/api-keys            → 201 { id, keyPrefix, secret*, scopes, ... }
GET    /api/v1/api-keys            → 200 [{ id, name, keyPrefix, scopes, status }]
DELETE /api/v1/api-keys/{id}       → 204

# * secret solo aparece en la respuesta 201 de creación. Nunca más.
```

### 8.3 Formato de error estándar

```json
{
  "error": {
    "code": "API_KEY_NOT_FOUND",
    "message": "The requested API key does not exist or has been revoked.",
    "correlationId": "550e8400-e29b-41d4-a716-446655440000",
    "timestamp": "2025-01-15T10:30:00.000Z"
  }
}
```

- Códigos de error: `SCREAMING_SNAKE_CASE`, específicos de dominio
- Stack traces nunca expuestos en producción
- Errores de validación incluyen campo `details` con errores por field

### 8.4 Autenticación — Dos mecanismos

**A) JWT — Usuarios administradores**

```
Header: Authorization: Bearer <jwt>
Payload: { sub: userId, tenantId, role, iat, exp }
Access token TTL: 15 minutos
Refresh token TTL: 7 días (rotado en cada uso)
Secreto JWT: desde SecretProvider (SSM en prod, env var en dev)
```

- JWTs **NUNCA** contienen secrets ni credentials en el payload
- JWTs de usuario **NUNCA** se usan como credenciales de integración permanentes

**B) API Key — Sistemas externos (activo desde Fase 0)**

```
Header: X-API-Key: bk_{env}_{8-char-prefix}_{32-char-secret}
Ejemplos:
  bk_live_a1b2c3d4_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx (producción)
  bk_test_e5f6g7h8_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx (sandbox)
```

- `prefix` (8 chars): almacenado en texto en `key_prefix` — lookup rápido sin exponer el secret
- `secret` (32 chars): hasheado con argon2id — **mostrado una sola vez** en el response de creación
- Scopes: validados por endpoint. Fase 0 inicia con scopes para operaciones admin.
- Environment: separación explícita `LIVE` / `TEST`
- Companies autorizadas: la ApiKey solo opera sobre sus companies asociadas en `ApiKeyCompany`

### 8.5 Headers estándar

| Header | Dirección | Descripción |
|---|---|---|
| `X-Correlation-ID` | Request + Response | UUID propagado en toda la request. Generado si no viene en la request. |
| `X-API-Key` | Request | Autenticación de sistemas externos |
| `Authorization: Bearer` | Request | Autenticación de usuarios |

---

## 9. Current Security Boundaries

### 9.1 Modelo de aislamiento multi-tenant

```
Tenant A                    Tenant B
  │                           │
  ├── Companies A1, A2        ├── Companies B1
  ├── Users A1, A2, A3        ├── Users B1
  ├── ApiKeys A1              ├── ApiKeys B1, B2
  └── AuditLogs (solo A)      └── AuditLogs (solo B)

Garantías:
  1. Todo repository filtra por tenantId desde TenantContext (AsyncLocalStorage)
  2. Endpoints de negocio siempre operan dentro del tenant autenticado
  3. No existe endpoint que cruce tenants en el API pública
```

### 9.2 Secretos — Reglas no negociables

| Secreto | Almacenamiento prod | Almacenamiento dev | Recuperable |
|---|---|---|---|
| API Key secret | Hash argon2id en DB | Hash argon2id en DB | ❌ Nunca |
| Contraseña usuario | Hash argon2id en DB | Hash argon2id en DB | ❌ Nunca |
| JWT signing secret | SSM Parameter Store (SecureString) | Variable de entorno | ❌ Solo por el proceso |
| Credenciales Hacienda empresa (Fase 2+) | SSM Parameter Store + KMS | Variable de entorno | ❌ Nunca en API/logs |
| Certificado PKCS#12 Hacienda (Fase 3+) | SSM Parameter Store + KMS | Variable de entorno | ❌ Solo por el proceso de firma |
| DATABASE_URL | SSM Parameter Store | Variable de entorno `.env.local` | ❌ Solo por el proceso |
| AWS credentials | IAM Role (ECS Task Role) | Variables de entorno locales | ❌ No en código |

**Credenciales Hacienda de clientes NUNCA en respuestas API ni en logs.**

### 9.3 Reglas de seguridad en logging

- Nunca loggear: passwords, API Key secrets completos, JWT tokens, credenciales Hacienda
- Los request bodies se redactan antes de loggearse (campos: `password`, `secret`, `token`, `credential`)
- Audit log registra acciones, no payloads completos (excepto cuando sea necesario y esté documentado y aprobado)

### 9.4 Validación de inputs

- `ValidationPipe` global: `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`
- UUIDs validados con `@IsUUID()`
- Strings con longitud máxima definida en cada DTO
- No se acepta input con tipos no definidos explícitamente

---

## 10. Current Container and Deployment Architecture

### 10.1 Stack de producción

```
┌──────────────────────────────────────────────────────┐
│                    AWS (ECS)                         │
│                                                      │
│  [billing-api Task]    [billing-worker Task]         │
│       port 3000               (no HTTP público)      │
│           │                        │                 │
│           └────────────┬───────────┘                 │
│                        │                             │
│                [PostgreSQL RDS]                      │
│                  ├── app schema                      │
│                  └── pgboss schema (queue)           │
│                                                      │
│                [S3 Bucket]                           │
│                  └── billing-documents               │
│                                                      │
│           [AWS SSM Parameter Store]                  │
│                  /billing/production/*               │
└──────────────────────────────────────────────────────┘
```

### 10.2 Docker Compose — Desarrollo local

```yaml
# docker-compose.yml
version: "3.9"
services:
  billing-api:
    build:
      context: .
      target: runner
    command: node dist/bootstrap/api.main.js
    ports:
      - "3000:3000"
    depends_on:
      postgres:
        condition: service_healthy
    env_file: .env.local

  billing-worker:
    build:
      context: .
      target: runner
    command: node dist/bootstrap/worker.main.js
    depends_on:
      postgres:
        condition: service_healthy
    env_file: .env.local

  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: billing
      POSTGRES_USER: billing
      POSTGRES_PASSWORD: billing_dev
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U billing"]
      interval: 5s
      timeout: 5s
      retries: 5

  localstack:
    image: localstack/localstack:3
    environment:
      SERVICES: s3
    ports:
      - "4566:4566"
    volumes:
      - localstack_data:/var/lib/localstack

volumes:
  postgres_data:
  localstack_data:
```

**No hay Redis** en el docker-compose. No se añade sin necesidad demostrada.

### 10.3 Dockerfile (multi-stage)

```dockerfile
# Stage 1: Instalar dependencias
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# Stage 2: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build
RUN npm prune --production

# Stage 3: Runner (imagen mínima para producción)
FROM node:20-alpine AS runner
RUN addgroup -S billing && adduser -S billing -G billing
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
USER billing
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:3000/health || exit 1
CMD ["node", "dist/bootstrap/api.main.js"]
```

API y Worker usan la misma imagen. El `command` en docker-compose o en la Task Definition ECS diferencia el proceso.

### 10.4 Variables de entorno

```bash
# Runtime
NODE_ENV=development|staging|production
PORT=3000

# Database — también es el backend de pg-boss
DATABASE_URL=postgresql://billing:billing_dev@localhost:5432/billing

# Secret Provider: 'env' (dev) | 'ssm' (staging/prod)
SECRET_PROVIDER=env

# JWT (en dev desde env; en prod desde SSM via SecretProvider)
JWT_SECRET=dev-only-change-in-production
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# AWS (solo cuando SECRET_PROVIDER=ssm)
AWS_REGION=us-east-1
SSM_PARAMETER_PREFIX=/billing/production/

# Object Storage
STORAGE_TYPE=local|s3
AWS_S3_BUCKET=billing-documents
AWS_S3_ENDPOINT=http://localhost:4566  # LocalStack en dev

# Logging
LOG_LEVEL=debug   # debug en dev | info en prod
```

### 10.5 Health Checks

```
GET /health       → { status: "ok" }                        200
GET /health/ready → { status: "ok", db: "ok" }              200 | 503
GET /health/live  → { status: "ok" }                        200
```

Implementados con `@nestjs/terminus`. La readiness verifica conectividad con PostgreSQL (que también es el backend de pg-boss). No hay Redis que verificar.

---

## 11. Current Testing Strategy

### 11.1 Pirámide de tests

```
             ┌──────────────────────────┐
             │        E2E Tests         │  ← Pocos, costosos.
             │  (Supertest + real DB)   │     Flujos completos end-to-end.
             ├──────────────────────────┤
             │   Integration Tests      │  ← Repositories contra PostgreSQL real.
             │  (TestContainers / db)   │     Use cases con adapters reales.
             ├──────────────────────────┤
             │      Unit Tests          │  ← Muchos. Domain entities, VOs,
             │  (Domain + Application)  │     Use case handlers. Sin mocks de infra.
             └──────────────────────────┘
```

### 11.2 Reglas de testing

| Capa | Estrategia | Mocks |
|---|---|---|
| Domain | Unit tests puros — Jest sin mocks de framework | Ninguno |
| Application (Use Cases) | Unit tests con mocks de ports (interfaces) | Repositories mockeados (in-memory) |
| Infrastructure (Repositories) | Integration tests contra PostgreSQL real | Ninguno — BD real en CI via service |
| HTTP (Controllers) | Integration tests con Supertest | Repositorios in-memory o BD de test |
| Hacienda | `MockHaciendaAdapter` con fixtures pre-grabados | No necesita conectividad real |
| Queue | `InMemoryJobQueue` en tests | pg-boss no se usa en tests unitarios |
| Secrets | `EnvSecretProvider` en tests | SSM no se usa en tests |

### 11.3 Convenciones de archivos

```
# Unit tests de dominio
src/modules/identity/domain/entities/__tests__/tenant.entity.spec.ts

# Unit tests de use cases
src/modules/identity/application/use-cases/create-tenant/__tests__/create-tenant.handler.spec.ts

# Integration tests de repositorios
src/modules/identity/infrastructure/persistence/__tests__/tenant.repository.integration.spec.ts

# E2E tests
test/e2e/tenants.e2e-spec.ts
test/e2e/api-keys.e2e-spec.ts
test/e2e/auth.e2e-spec.ts
```

---

## 12. Active Architectural Decisions

### AD-001: Monolito Modular — NestJS + TypeScript
**Estado:** ✅ Activa (U-01) | **ADR:** ADR-001

Billing se construye como un monolito modular con NestJS en TypeScript strict mode. Los módulos de dominio tienen fronteras explícitas pero comparten proceso, base de datos y deployment. No se usan microservicios hasta que exista una necesidad técnica u organizacional demostrable. La estructura de módulos NestJS refleja directamente los bounded contexts del dominio.

### AD-002: Prisma ORM separado del dominio + Row-level multi-tenancy
**Estado:** ✅ Activa (U-02) | **ADR:** ADR-002

ORM = Prisma. Las entidades de dominio son clases TypeScript puras — NO Prisma models. Existe mapping explícito en cada repository adapter. Multi-tenancy mediante `tenant_id` en todas las tablas tenant-aware. TenantContext propagado via `AsyncLocalStorage`. Hashing con argon2id para passwords y API Keys.

### AD-003: pg-boss como queue sobre PostgreSQL — Sin Redis
**Estado:** ✅ Activa (U-03) | **ADR:** ADR-003

Queue = pg-boss sobre el mismo PostgreSQL de la aplicación. Redis NO es parte de la infraestructura. `JobQueuePort` abstrae pg-boss: las implementaciones `PgBossJobQueue`, `BullMQJobQueue` y `SqsJobQueue` son intercambiables sin cambiar la lógica de negocio. `InMemoryJobQueue` para tests.

### AD-004: HaciendaPort + MockHaciendaAdapter obligatorio
**Estado:** ✅ Activa (U-04) | **ADR:** ADR-004

Toda interacción con Hacienda va a través de `HaciendaPort`. `MockHaciendaAdapter` siempre disponible para dev y CI. Dev y tests nunca requieren credenciales ni conectividad real de Hacienda. URLs de Hacienda solo en infraestructura/configuración, nunca en dominio o aplicación.

### AD-005: XAdES XML Signing — Technical Spike obligatorio
**Estado:** ⚠️ Spike pendiente (U-05) | **ADR:** ADR-005

La firma XAdES es una incógnita técnica. No comprometerse a biblioteca hasta evaluar compatibilidad, certificate handling, canonicalización y mantenimiento en Node.js. Abstracción `XmlSignerPort` obligatoria independientemente de la biblioteca elegida. Un signer NO es production-ready hasta que un documento firmado sea validado exitosamente por Hacienda o mecanismo oficial.

### AD-006: AWS SSM Parameter Store — SecretProvider abstraction
**Estado:** ✅ Activa (U-06) | **ADR:** ADR-006

Secret management en producción = AWS SSM Parameter Store con SecureString + KMS. NO AWS Secrets Manager en fases iniciales. Dev usa `EnvSecretProvider` (variables de entorno). `SecretProvider` interface es obligatoria — permite migrar sin cambiar lógica de negocio. Least-privilege IAM. JWT nunca almacena secrets ni credentials en su payload.

### AD-007: GitHub Actions — CI/CD con gates obligatorios
**Estado:** ✅ Activa (U-07) | **ADR:** ADR-007

CI/CD = GitHub Actions. Gates obligatorios en todo PR: `lint`, `typecheck`, `test`, `build`, `verify`. PR no es completo si algún gate falla. La arquitectura no está acoplada a GitHub Actions — los scripts son independientes.

### AD-008: Auth + AuthZ desde Fase 0
**Estado:** ✅ Activa (U-08) | **ADR:** ADR-008

El modelo de seguridad (User, Tenant, Company, Role, Permission, Authentication, Authorization, Audit Actor) existe desde Fase 0. Humans via JWT. External systems via API Keys. La UI llega en Fase 8 pero los endpoints administrativos necesitan auth desde el principio. JWTs de usuario NUNCA como credenciales de integración permanentes.

### AD-009: Retención configurable — No hardcoded
**Estado:** ✅ Activa (U-09) | **ADR:** ADR-009

Documentos fiscales deben soportar el período de retención legalmente requerido en CR. Política configurable — no hardcoded en lógica de negocio. Audit logs append-only. Object Storage lifecycle policies configurables independientemente. NO tratar backups como mecanismo oficial de retención. Períodos finales deben confirmarse contra requisitos legales CR antes de producción.

### AD-010: Auth + AuthZ desde Fase 0
**Estado:** ✅ Activa (U-10) | **ADR:** ADR-010

Billing e Inventori son sistemas completamente independientes. No comparten: database, sessions, auth state, users, domain models, Prisma schemas, ni acceso directo a BD. Inventori es el primer consumidor de la API pública de Billing via API Keys. API Keys soportan: scopes, autorización explícita por company, revocación, rotación, separación test/live, audit trail, rate limiting futuro, secreto no recuperable.

---

## 13. Known Architectural Limitations

| # | Limitación | Impacto actual | Plan |
|---|---|---|---|
| L-01 | Row-level tenancy sin PostgreSQL RLS | Un bug en TenantContext podría cruzar tenant boundaries | Añadir RLS como capa adicional en Fase 1+ |
| L-02 | Sin circuit breaker | Calls a Hacienda (Fase 1+) pueden cascadear | Añadir en Fase 1 con biblioteca de resiliencia (cockatiel, opossum) |
| L-03 | Sin rate limiting | Posible abuso de endpoints | Añadir `@nestjs/throttler` en Fase 1 |
| L-04 | JWT sin revocación inmediata | Token robado válido hasta expiración (15 min) | Aceptable por TTL corto. Token blacklist si se requiere mayor seguridad. |
| L-05 | `XmlSignerPort` sin implementación production-ready | Fase 3 bloqueada hasta resolver spike | ADR-005 debe completarse y validarse antes de Fase 3 |
| L-06 | Política de retención de audit logs no implementada | Crecimiento ilimitado de tabla audit_logs | Definir y configurar lifecycle/particionamiento en Fase 1-2 |

---

## 14. Open Decisions Requiring Clarification

**No hay decisiones pendientes de la ronda U-01 a U-10.** Todas han sido aprobadas y registradas en los ADRs correspondientes.

| Decisión | Estado | ADR |
|---|---|---|
| U-01: Framework + estructura de módulos | ✅ Resuelto | ADR-001 |
| U-02: ORM + multi-tenancy + hashing | ✅ Resuelto | ADR-002 |
| U-03: Queue — pg-boss sobre PostgreSQL, sin Redis | ✅ Resuelto | ADR-003 |
| U-04: Hacienda detrás de Port/Adapter, MockHaciendaAdapter obligatorio | ✅ Resuelto | ADR-004 |
| U-05: XAdES signing — Technical Spike obligatorio antes de Fase 3 | ✅ Spike aprobado | ADR-005 |
| U-06: AWS SSM Parameter Store, SecretProvider abstraction | ✅ Resuelto | ADR-006 |
| U-07: GitHub Actions CI/CD, gates obligatorios | ✅ Resuelto | ADR-007 |
| U-08: Auth + AuthZ desde Fase 0, JWT + API Keys | ✅ Resuelto | ADR-008 |
| U-09: Retención configurable, no hardcoded, confirmar requisito legal CR | ✅ Resuelto | ADR-009 |
| U-10: Billing e Inventori son sistemas completamente independientes | ✅ Resuelto | ADR-010 |
