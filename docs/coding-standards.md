# Coding Standards
> Derived from observable patterns in the Billing repository (post-Fase-1).
> These standards reflect actual conventions used throughout the codebase.

---

## 1. General principles

1. **Domain independence first.** Domain code (`entities/`, `value-objects/`, `exceptions/`) MUST NOT import NestJS decorators, Prisma types, ORM models, or any infrastructure library.
2. **Ports over implementations.** Use-case handlers depend only on port interfaces (TypeScript interfaces + Symbol tokens). Never import concrete adapters into application code.
3. **DTO isolation.** Domain entities are never serialized directly to HTTP responses. Controllers always map to dedicated DTO classes.
4. **Fail loudly on configuration.** All environment variables are validated with Joi on startup (`config.module.ts`). Missing required variables crash the process immediately.
5. **Prefer explicit over implicit.** Tenant isolation, scope enforcement, and audit recording are all explicit mechanisms — not hidden middleware or magic.

---

## 2. Project structure conventions

### Module layout (business modules)
```
src/modules/{module-name}/
  {module-name}.module.ts
  domain/
    entities/
      {entity-name}.entity.ts
    value-objects/
      {vo-name}.vo.ts
    exceptions/
      {exception-name}.exception.ts
    ports/
      {entity-name}.repository.ts
    events/
      {event-name}.event.ts
    __tests__/
      {entity-name}.entity.spec.ts
      {vo-name}.vo.spec.ts
  application/
    use-cases/
      {use-case-name}/
        {use-case-name}.handler.ts
        {use-case-name}.command.ts   (when needed)
        {use-case-name}.result.ts    (when needed)
        {use-case-name}.query.ts     (when needed)
    __tests__/
      {use-case-name}.handler.spec.ts
  infrastructure/
    http/
      {module-name}.controller.ts
      dtos/
        {operation}.request.dto.ts
        {operation}.response.dto.ts
    persistence/
      prisma-{entity-name}.repository.ts
```

### Infrastructure layout (cross-cutting)
```
src/infrastructure/{concern}/
  ports/
    {concern}.port.ts           # Interface + Symbol token
  adapters/
    {impl}-{concern}.adapter.ts # Concrete implementation
  {concern}.module.ts
```

### Test file location
- Unit tests: co-located in `__tests__/` folder next to the code under test
- E2E tests: `test/e2e/fase{N}/{feature}.e2e-spec.ts`
- Fixtures: `src/infrastructure/integrations/hacienda/__tests__/fixtures/`

---

## 3. Naming conventions

### Files
| Type | Convention | Example |
|---|---|---|
| Entity | `{name}.entity.ts` | `company.entity.ts` |
| Value Object | `{name}.vo.ts` | `identification-number.vo.ts` |
| Domain exception | `{name}.exception.ts` | `company-not-found.exception.ts` |
| Repository port | `{entity}.repository.ts` | `company.repository.ts` |
| Use-case handler | `{use-case}.handler.ts` | `create-company.handler.ts` |
| Controller | `{module}.controller.ts` | `company.controller.ts` |
| Request DTO | `{operation}.request.dto.ts` | `create-company.request.dto.ts` |
| Response DTO | `{operation}.response.dto.ts` | `company.response.dto.ts` |
| Prisma repository | `prisma-{entity}.repository.ts` | `prisma-company.repository.ts` |
| Port adapter | `{impl}-{concern}.adapter.ts` | `hacienda-api.adapter.ts` |
| NestJS module | `{module}.module.ts` | `companies.module.ts` |
| Config namespace | `{concern}.config.ts` | `hacienda.config.ts` |

### Classes
- Entities: `PascalCase` noun (e.g., `Company`, `ApiKey`)
- Value Objects: `PascalCase` noun with no suffix (e.g., `IdentificationNumber`, `TenantSlug`)
- Domain exceptions: `PascalCase` + `Exception` (e.g., `CompanyNotFoundException`)
- Use-case handlers: `PascalCase` + `Handler` (e.g., `CreateCompanyHandler`)
- Repository interfaces: `I` prefix + `PascalCase` + `Repository` (e.g., `ICompanyRepository`)
- Port constants: `SCREAMING_SNAKE_CASE` (e.g., `COMPANY_REPOSITORY`, `HACIENDA_PORT`)
- Controllers: `PascalCase` + `Controller`
- Guards: `PascalCase` + `Guard`
- DTOs: `PascalCase` + `Dto`

### Methods
- Use-case handlers expose a single `execute(command | query)` method
- Repository interfaces use: `findById`, `findBy*`, `save`, `delete`
- Domain entity factory methods: `static create(...)` and `static reconstruct(...)`

---

## 4. Domain layer rules

### Entities
- Extend `AggregateRoot<TId>` (aggregate roots) or `BaseEntity<TId>` (internal entities)
- Private constructor enforced; creation via `static create(...)` and hydration via `static reconstruct(...)`
- All properties private with public getters
- Mutable state changes only via named domain methods (e.g., `revoke(revokedBy: string)`)
- No NestJS decorators, no Prisma types, no HTTP types

```typescript
// CORRECT
export class Company extends AggregateRoot<string> {
  private _legalName: string;

  private constructor(id: string, props: CompanyProps, ...) {
    super(id, createdAt, updatedAt);
    this._legalName = props.legalName;
  }

  get legalName(): string { return this._legalName; }

  static create(id: string, ...): Company { ... }
  static reconstruct(props: CompanyReconstructProps): Company { ... }
}

// WRONG
export class Company {
  @Column() legalName: string; // Prisma/TypeORM in domain
}
```

### Value Objects
- Extend `ValueObject<TProps>`
- Immutable — no setters
- Validation in `static create()` — throw domain exceptions on invalid input
- Encapsulate business rules for primitive validation (identification numbers, slugs, emails)

### Domain exceptions
- Extend `DomainException` (abstract base with `code: string` and `httpStatus: number`)
- Named in past or noun form describing what went wrong (e.g., `CompanyAlreadyExistsException`)
- `httpStatus` reflects the correct HTTP semantics (404, 409, 422, 503, etc.)

```typescript
export class CompanyNotFoundException extends DomainException {
  readonly code = 'COMPANY_NOT_FOUND';
  readonly httpStatus = 404;
  constructor(id: string) {
    super(`Company with id '${id}' was not found.`);
  }
}
```

### Repository ports
- TypeScript interface + exported Symbol constant
- Interface name: `IEntityRepository`
- Symbol name: `ENTITY_REPOSITORY`

```typescript
export interface ICompanyRepository {
  findById(id: string): Promise<Company | null>;
  save(company: Company): Promise<void>;
}
export const COMPANY_REPOSITORY = Symbol('ICompanyRepository');
```

---

## 5. Application layer rules

### Use-case handlers
- Decorated with `@Injectable()`
- Single public `execute(command)` method
- Constructor injects only ports (via `@Inject(SYMBOL)`) and logger
- Orchestrates domain, calls ports, maps results — no business logic in handlers
- Never import Prisma types or HTTP decorators

```typescript
@Injectable()
export class CreateCompanyHandler {
  constructor(
    @Inject(COMPANY_REPOSITORY) private readonly companyRepository: ICompanyRepository,
    @Inject(HACIENDA_PORT) private readonly haciendaPort: HaciendaPort,
  ) {}

  async execute(command: CreateCompanyCommand): Promise<CreateCompanyResult> {
    // orchestration only
  }
}
```

### Commands and results
- Defined as `interface` or `readonly` class
- All properties `readonly`
- No business logic

---

## 6. Infrastructure layer rules

### Controllers
- Decorated with `@ApiTags(...)` and appropriate `@UseGuards(...)`
- Single responsibility: parse input, call handler, map to DTO
- No business logic in controllers
- Use `@SkipThrottle()` for JWT-authenticated endpoints (rate limiting is on API key endpoints)

```typescript
@ApiTags('Companies')
@UseGuards(JwtAuthGuard)
@Controller('companies')
export class CompanyController {
  async createCompany(@Request() req, @Body() dto: CreateCompanyRequestDto): Promise<CompanyResponseDto> {
    const result = await this.createCompanyHandler.execute({ ... });
    return { ...result }; // explicit mapping, never return domain entity
  }
}
```

### Prisma repositories
- Extend `TenantAwarePrismaRepository` for tenant-scoped entities
- Always call `this.applyTenantFilter({...})` in every where clause
- Map Prisma records to domain entities using `Entity.reconstruct()`
- Never expose Prisma types outside the repository

```typescript
export class PrismaCompanyRepository extends TenantAwarePrismaRepository implements ICompanyRepository {
  async findById(id: string): Promise<Company | null> {
    const record = await this.prisma.company.findFirst({
      where: this.applyTenantFilter({ id }),
    });
    return record ? Company.reconstruct({ ...record }) : null;
  }
}
```

### Output adapters (non-database)
- Implement the corresponding port interface
- Private DTOs for external API shapes — never exported
- All field mapping from external names to Billing-owned names done here only

---

## 7. NestJS module conventions

### Module definition order
```typescript
@Module({
  imports: [],       // Other modules whose exports this module needs
  controllers: [],   // Input adapters
  providers: [
    // Use-case handlers
    // Port bindings (provide + useClass or useFactory)
    // Guards (if exported)
  ],
  exports: [],       // Handlers and services needed by other modules
})
```

### Port binding pattern
```typescript
{
  provide: COMPANY_REPOSITORY,
  useClass: PrismaCompanyRepository,
}
```

### Adapter selection via factory
```typescript
{
  provide: HACIENDA_PORT,
  useFactory: (configService: ConfigService, ...) => {
    const useReal = configService.get<boolean>('hacienda.useReal') ?? false;
    return useReal ? new HaciendaApiAdapter(...) : new MockHaciendaAdapter();
  },
  inject: [ConfigService, ...],
}
```

---

## 8. Configuration conventions

### Config namespace registration
Each concern registers a typed namespace:
```typescript
// hacienda.config.ts
export default registerAs('hacienda', () => ({
  apiBaseUrl: process.env.HACIENDA_API_BASE_URL ?? 'https://api.hacienda.go.cr',
  timeoutMs: parseInt(process.env.HACIENDA_TIMEOUT_MS ?? '10000', 10),
  ...
}));
```

### Joi validation
All variables are validated in `config.module.ts`:
- Required variables: `Joi.string().required()`
- Optional with defaults: `Joi.string().default('value')`
- Production-conditional: `Joi.when('NODE_ENV', { is: 'production', then: ... })`

### Accessing config
- Always use `configService.get<Type>('namespace.key')` in services and factories
- Never read `process.env` directly in business code (except config files and bootstrap)

---

## 9. Guards and authentication conventions

### Guard chain for API key endpoints
Applied in order via `@UseGuards(...)`:
1. `ApiKeyAuthGuard` — validates X-API-Key, attaches `request.apiKey`
2. `ApiKeyThrottlerGuard` — Layer A per-key rate limit
3. `ScopeGuard` — scope enforcement (reads `request.apiKey.scopes`)

Always declare `@Scopes(...)` on route handlers, not on the controller class (unless all routes require the same scope).

### Guard chain for JWT endpoints
```typescript
@UseGuards(JwtAuthGuard)
```
Single guard. Attaches `request.user = { userId, tenantId, role }`.

### ThrottlerGuard usage
- API key endpoints: `ApiKeyThrottlerGuard` (uses API key ID as tracker)
- Auth endpoints: `@Throttle({ auth: { ttl: 60000, limit: 10 } })`
- Skip throttle on JWT endpoints: `@SkipThrottle()`

---

## 10. Error handling conventions

### Domain exceptions
- All domain errors extend `DomainException`
- `GlobalExceptionFilter` maps `DomainException.httpStatus` to HTTP status
- Do not throw `HttpException` from domain or application code — throw `DomainException`

### Infrastructure exceptions
- Infrastructure errors (Hacienda unavailable, Prisma errors) must be caught and either mapped to domain exceptions or re-thrown as `DomainException` subclasses
- Never let Prisma errors or Axios errors propagate to the controller layer uncaught

### Logging
- Use `new Logger(ClassName.name)` from `@nestjs/common`
- Log at `warn` level for expected failures (Hacienda unavailable, validation errors)
- Log at `error` level for unexpected failures
- Log at `debug` level for diagnostic information
- Never log PII, secrets, or full request bodies

---

## 11. Test conventions

### Unit test structure
```typescript
describe('EntityName / FeatureName', () => {
  describe('when <condition>', () => {
    it('<expected behavior>', () => {
      // Arrange
      // Act
      // Assert
    });
  });
});
```

### Mock pattern for use-case tests
```typescript
const mockRepository: jest.Mocked<ICompanyRepository> = {
  findById: jest.fn(),
  save: jest.fn(),
  findByIdentificationNumber: jest.fn(),
};
```

### E2E test structure
- Create full `AppModule` via `Test.createTestingModule({ imports: [AppModule] })`
- Apply global pipes, filters, and interceptors as in `api.main.ts`
- Use `supertest` for HTTP assertions
- Use `test/helpers/test-factories.ts` for database setup helpers
- Clean up database state in `afterAll`

### What to test
- Domain entities: all state transitions, invariants, factory methods
- Value objects: valid inputs, invalid inputs (boundary conditions)
- Guards: fail-closed behavior, AND semantics, error codes
- Adapters: fixture-based response mapping, error scenarios
- Circuit breakers: state machine transitions, retry logic
- E2E: auth flows, happy paths, 400/401/403/404 scenarios

---

## 12. Audit and observability conventions

### Correlation ID
Every request gets an `X-Correlation-ID` header (generated if not provided).
Correlation IDs flow through: `request.correlationId` -> `AuditInterceptor` -> `audit_logs.correlation_id`.

### Audit log event classes (ADR-009)
- `FISCAL_AUDIT`: events with >= 5-year retention (fiscal lifecycle)
- `SECURITY`: authentication events, API key events
- `TECHNICAL`: all other HTTP activity (default)

### Audit best practices
- `AuditService.record()` is fire-and-forget — never `await` it
- Do not audit health check endpoints
- Actor field: `userId` (JWT) | `keyPrefix` (API key) | `"system"` (background job)

---

## 13. Hacienda integration conventions

### Field name isolation (BR-012)
Hacienda uses Spanish field names (`nombre`, `venta`, `compra`, `codigo`, `impuesto`, `identificacion`).
- Hacienda DTOs are defined as **private interfaces** inside `hacienda-api.adapter.ts`
- `HaciendaPort` uses **Billing-owned English names** only
- The mapping from Hacienda names to Billing names happens in `private map*()` methods inside the adapter
- No Hacienda field name may appear in any DTO, entity, controller, or test outside the adapter and fixture files

### Not-found detection (BR-014)
Hacienda returns HTTP 200 with body `{ code: 404, status: "..." }` when a taxpayer is not found.
The adapter checks `data.code === 404` to detect not-found — never relies on HTTP status code.

### Cache key patterns
```
taxpayer:{identification}
exchange-rate:{currency}:{date}       # date as YYYY-MM-DD
cabys:code:{code}
cabys:search:{query.toLowerCase()}:{limit}
```

### Best-effort verification in company creation
`CreateCompanyHandler` calls `HaciendaPort.getTaxpayer()` inside a try/catch.
Any failure sets `haciendaVerificationStatus` to `UNAVAILABLE` or `ERROR`.
**The company is always saved regardless of Hacienda availability (DEC-003).**
