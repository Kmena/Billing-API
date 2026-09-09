# Billing — Facturación Electrónica Costa Rica

A multi-tenant SaaS billing platform for Costa Rica electronic invoicing (comprobantes electrónicos). Built with NestJS, TypeScript, Hexagonal Architecture and PostgreSQL.

## Architecture

- **Style:** Monolito Modular con Arquitectura Hexagonal (Ports & Adapters)
- **Framework:** NestJS + TypeScript (strict mode)
- **Database:** PostgreSQL 15+ via Prisma ORM
- **Queue:** pg-boss (PostgreSQL-backed — no Redis)
- **Auth:** JWT (users) + API Keys (systems)
- **Storage:** AWS S3 (prod) / LocalStack (dev) / Local filesystem
- **Secrets:** AWS SSM Parameter Store (prod) / Environment variables (dev)

See [docs/architecture.md](docs/architecture.md) for the complete architecture specification.

---

## Requirements

- Node.js v20+ LTS
- npm v9+
- Docker Desktop (for PostgreSQL and LocalStack)
- Git

---

## Local Setup

### 1. Clone and install

```bash
git clone <repository-url>
cd billing
npm install
```

### 2. Configure environment variables

```bash
cp .env.local.example .env.local
# Edit .env.local with your local settings
```

Minimum required variables:
- `DATABASE_URL` — PostgreSQL connection string

### 3. Start infrastructure (PostgreSQL + LocalStack)

```bash
# Start only postgres and localstack (not the app — you'll run it locally)
docker-compose up postgres localstack -d
```

### 4. Run database migrations

```bash
npm run db:migrate:dev
```

### 5. Seed initial data (first admin user)

```bash
npm run db:seed
# Creates tenant 'Default Tenant' and admin@billing.local / ChangeMe123!
# Change the password after first login!
```

### 6. Start the API

```bash
npm run start:dev
# API available at http://localhost:3000
# Swagger docs at http://localhost:3000/api/docs (non-production only)
```

---

## Available Scripts

| Command | Description |
|---|---|
| `npm run start:dev` | Start API in watch mode |
| `npm run start:dev:worker` | Start Worker in watch mode |
| `npm run build` | Compile TypeScript to dist/ |
| `npm run typecheck` | Type check without compiling |
| `npm run lint` | Run ESLint with auto-fix |
| `npm run lint:check` | Run ESLint without auto-fix |
| `npm test` | Run unit + integration tests |
| `npm run test:cov` | Run tests with coverage |
| `npm run test:e2e` | Run end-to-end tests |
| `npm run db:migrate:dev` | Apply migrations (development) |
| `npm run db:migrate:deploy` | Apply migrations (production) |
| `npm run db:generate` | Regenerate Prisma client |
| `npm run db:studio` | Open Prisma Studio (DB GUI) |
| `npm run db:reset` | Reset and re-apply all migrations |
| `npm run db:seed` | Seed initial admin data |

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | ✅ Always | — | PostgreSQL connection string |
| `NODE_ENV` | — | `development` | `development` / `production` / `test` |
| `PORT` | — | `3000` | HTTP port |
| `LOG_LEVEL` | — | `info` | `trace`/`debug`/`info`/`warn`/`error`/`fatal` |
| `JWT_SECRET` | ✅ Production | insecure dev default | JWT signing secret (min 32 chars in prod) |
| `JWT_EXPIRES_IN` | — | `15m` | Access token TTL |
| `JWT_REFRESH_EXPIRES_IN` | — | `7d` | Refresh token TTL |
| `STORAGE_TYPE` | — | `local` | `local` or `s3` |
| `AWS_S3_BUCKET` | S3 only | — | S3 bucket name |
| `AWS_S3_ENDPOINT` | S3 + LocalStack | — | S3 endpoint (for LocalStack: `http://localhost:4566`) |
| `AWS_REGION` | — | `us-east-1` | AWS region |
| `SECRET_PROVIDER` | — | `env` | `env` (dev) or `ssm` (prod) |
| `SSM_PARAMETER_PREFIX` | SSM only | `/billing` | Parameter Store path prefix |
| `SEED_ADMIN_EMAIL` | — | `admin@billing.local` | Seed admin email |
| `SEED_ADMIN_PASSWORD` | — | `ChangeMe123!` | Seed admin password |

---

## API Endpoints

All business endpoints are prefixed with `/api/v1`.

### Health
| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | None | Liveness check |
| `GET` | `/health/ready` | None | Readiness check (verifies DB) |
| `GET` | `/health/live` | None | Liveness alias |

### Authentication
| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/v1/auth/login` | None | Login with email + password |
| `POST` | `/api/v1/auth/refresh` | None | Refresh access token |

### Tenants
| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/v1/tenants` | JWT | Create tenant |
| `GET` | `/api/v1/tenants/:id` | JWT | Get tenant by ID |

### Companies
| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/v1/companies` | JWT | Create company |
| `GET` | `/api/v1/companies/:id` | JWT | Get company by ID |

### API Keys
| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/v1/api-keys` | JWT | Create API key (secret shown once) |
| `GET` | `/api/v1/api-keys` | JWT | List API keys (no secrets) |
| `DELETE` | `/api/v1/api-keys/:id` | JWT | Revoke API key |

### Swagger Documentation
Available at `GET /api/docs` in development environments.

---

## Multi-tenancy

Billing uses **row-level multi-tenancy**: every tenant-scoped table has a `tenant_id` column. All queries automatically include `WHERE tenant_id = $tenantId` via `TenantContext` (AsyncLocalStorage). Cross-tenant data access is architecturally impossible through normal API flows.

---

## Authentication

### JWT (Users)
```
POST /api/v1/auth/login
Content-Type: application/json
{ "tenantId": "...", "email": "...", "password": "..." }
→ { "accessToken": "...", "refreshToken": "...", "expiresIn": 900 }

# Use:
Authorization: Bearer <accessToken>
```

### API Keys (External Systems)
```
# Key format: bk_{env}_{prefix}_{secret}
X-API-Key: bk_live_a1b2c3d4_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```
- `env`: `live` or `test`
- `prefix`: 8-char hex, stored in plaintext for lookup
- `secret`: 32-char hex, hashed with argon2id — shown **only once** at creation

---

## Docker

```bash
# Full stack (api + worker + postgres + localstack)
docker-compose up

# Check health
curl http://localhost:3000/health
curl http://localhost:3000/health/ready
```

---

## CI/CD

GitHub Actions pipeline runs on push/PR to `main` and `develop`:
1. **lint** — ESLint
2. **typecheck** — TypeScript
3. **test** — Unit + integration (with PostgreSQL service)
4. **build** — TypeScript build
5. **e2e** — End-to-end tests

All gates must pass before a PR can be merged.

---

## Troubleshooting

**`npm run start:dev` fails with "Cannot connect to database"**
→ Ensure PostgreSQL is running: `docker-compose up postgres -d`

**`npm run db:migrate:dev` fails**
→ Check `DATABASE_URL` in `.env.local`

**Port 3000 already in use**
→ Set `PORT=3001` in `.env.local` or kill the existing process

**Swagger not showing**
→ Only available when `NODE_ENV !== 'production'`
