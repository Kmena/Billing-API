# Current State — Billing

> **Versión:** 1.0  
> **Fecha:** 2025  
> **Estado:** Proyecto greenfield — sin código fuente implementado  
> **Propietario:** hdd-architecture-agent-c0ad06

---

## 1. System Overview

**Billing** es un SaaS de facturación electrónica para Costa Rica que actuará como plataforma API-first para emitir, gestionar y consultar comprobantes electrónicos conforme a las disposiciones del Ministerio de Hacienda de CR (Administración Tributaria Virtual - ATV).

El sistema está diseñado para ser consumido por:
- **Inventori** (producto interno)
- Sistemas externos (POS, ERP, e-commerce) vía API Key

**Estado actual:** El proyecto se encuentra en fase de planificación arquitectónica. No existe código fuente, base de datos, infraestructura desplegada ni pruebas. Los únicos artefactos disponibles son:

| Artefacto | Descripción |
|---|---|
| `Billing PRD.pdf` | Documento de producto (no procesable directamente) |
| `Billing_Plan_Desarrollo.md` | Plan de desarrollo con 10 fases y 4 milestones |
| `SIGNED_*.xml` | Ejemplo real de FacturaElectronica v4.4 firmada con XAdES-EPES |

---

## 2. Repository Structure

```
Billing/
├── Billing PRD.pdf
├── Billing_Plan_Desarrollo.md
└── SIGNED_50601082600300257457000100002010000016068100003374.xml
```

No existe estructura de proyecto, configuración, código fuente, tests, migraciones, Dockerfile ni pipeline de CI/CD.

---

## 3. Current Architecture

**No existe arquitectura implementada.**

Las decisiones de stack confirmadas por el equipo para la construcción del sistema son:

| Decisión | Valor confirmado |
|---|---|
| Lenguaje / Runtime | TypeScript / Node.js |
| Deployment target | Docker → AWS (ECS/EKS eventualmente) |
| Base de datos principal | PostgreSQL |
| Queue | A definir (BullMQ/Redis recomendado) |
| Cache | Redis disponible |
| Object Storage | AWS S3 |
| Estilo arquitectónico | Monolito Modular + Hexagonal Architecture |

---

## 4. Existing Domains and Modules

No hay módulos implementados. Los dominios identificados en las especificaciones son:

| Módulo | Fase de introducción | Estado |
|---|---|---|
| Identity / Tenants | Fase 0 | Especificado, no implementado |
| Companies | Fase 0 | Especificado, no implementado |
| API Keys | Fase 1 | Especificado, no implementado |
| Taxpayers | Fase 1 | Especificado, no implementado |
| CABYS | Fase 1 | Especificado, no implementado |
| Tax Rules | Fase 3+ | Especificado, no implementado |
| Fiscal Documents | Fase 3 | Especificado, no implementado |
| Purchases | Fase 6 | Especificado, no implementado |
| Payments / Receipts | Fase 7 | Especificado, no implementado |
| Documents (Storage) | Fase 5 | Especificado, no implementado |
| Notifications / Email | Fase 5 | Especificado, no implementado |
| Webhooks | Fase 4 | Especificado, no implementado |
| Audit | Fase 0 | Especificado, no implementado |

---

## 5. Main Use Cases

Extraídos de `Billing_Plan_Desarrollo.md`. Ninguno implementado.

**Fase 0 (Foundation):**
- Crear y gestionar Tenants
- Crear y gestionar Companies por Tenant
- Gestionar usuarios con roles base
- Crear, listar y revocar API Keys
- Registrar eventos de auditoría
- Health checks del sistema

**Fase 1 (API Keys + Consultas Hacienda):**
- Autenticar vía API Key con scopes
- Consultar contribuyente por identificación (`GET /api/v1/taxpayers/{id}`)
- Consultar catálogo CABYS (`GET /api/v1/cabys/{code}`, `GET /api/v1/cabys?search=`)
- Consultar tipo de cambio (`GET /api/v1/exchange-rates`)

**Fases 2-10:** Especificados en `Billing_Plan_Desarrollo.md`. Fuera del alcance actual.

---

## 6. Current Data Flows

No existen flujos de datos implementados.

**Flujo de referencia documentado (Fase 3, para contexto):**
```
Request → API Key Auth → Company Validation → Input Validation
→ Tax Rules → Consecutive/Key Generation → Persist Document
→ Create Async Job → 202 Accepted
```

**Flujo Worker (Fase 4, para contexto):**
```
Job → Generate XML → Sign (XAdES-EPES) → Send Hacienda
→ Poll Status → ACCEPTED | REJECTED | RETRY
```

---

## 7. Database and Persistence

No existe base de datos configurada ni migraciones.

**Schema Hacienda v4.4 conocido** (extraído del XML de ejemplo):

La `Clave` de 50 dígitos tiene la siguiente estructura:
```
[3: país][2: día][2: mes][4: año][12: cédula emisor]
[20: NumeroConsecutivo][8: código seguridad][1: situación]
```

El `NumeroConsecutivo` de 20 dígitos tiene estructura:
```
[3: sucursal][5: terminal][2: tipo comprobante][10: secuencial]
```

Tipos de identificación Hacienda:
- `01` = Cédula física
- `02` = Cédula jurídica
- `03` = DIMEX
- `04` = NITE

Tipos de comprobante (primeros dos dígitos del tipo en NumeroConsecutivo):
- `01` = Factura Electrónica
- `02` = Tiquete Electrónico
- `03` = Nota de Crédito Electrónica
- `04` = Nota de Débito Electrónica
- `08` = Factura Electrónica de Compra
- `09` = Factura Electrónica de Exportación

---

## 8. APIs and Integrations

No hay API implementada.

**API externa conocida: Ministerio de Hacienda ATV**
- Staging: `https://api-sandbox.comprobanteselectronicos.go.cr`
- Producción: `https://api.comprobanteselectronicos.go.cr`
- Autenticación: OAuth2 (BCCR - Banco Central de Costa Rica)
- Firma digital: XAdES-EPES con RSA-SHA256 y certificado X.509 emitido por CA Hacienda
- Certificado formato: PKCS#12 (`.p12`)
- Schema XML: FacturaElectronica v4.4

La consulta de contribuyentes utiliza un endpoint público separado.

---

## 9. Authentication and Authorization

No implementado.

**Diseño especificado:**
- API Key con scopes para sistemas externos
- El secreto de la API Key se muestra una sola vez y se almacena hasheado
- Cada API Key está autorizada a compañías explícitas dentro del tenant
- Roles base de usuario (TENANT_ADMIN, MEMBER, READ_ONLY)

---

## 10. Events and Background Processing

No implementado.

**Workers especificados:**
- Hacienda submission
- Hacienda status polling
- Retries con backoff exponencial
- PDF generation
- Email delivery
- Webhook dispatch
- Received document processing

---

## 11. Containers and Deployment

No existe configuración de contenedores ni pipeline.

**Topología de procesos especificada:**
```
billing-api    → proceso HTTP
billing-worker → proceso de jobs asíncronos
```

Ambos del mismo codebase. Escalan independientemente.

---

## 12. Current Testing Strategy

No existen tests.

---

## 13. Behavior to Preserve

No hay comportamiento existente que preservar. Sistema greenfield.

**Invariantes de negocio identificadas en especificaciones (deben guiar el diseño desde el inicio):**
1. El secreto completo de una API Key se muestra una sola vez y nunca se recupera.
2. Cada API Key está vinculada a compañías autorizadas explícitamente.
3. Las credenciales de Hacienda de una empresa nunca se exponen por API ni se registran en logs.
4. Los consecutivos fiscales son únicos por empresa + tipo de comprobante.
5. La idempotencia en operaciones fiscales se garantiza mediante `Idempotency-Key`.
6. Las reglas fiscales son versionadas y auditables.
7. Cada acción queda registrada en el audit log con actor, timestamp y correlation ID.
8. Billing nunca usa credenciales fiscales globales para representar a múltiples clientes.

---

## 14. Known Defects

No aplica — sistema greenfield. No hay código con defectos.

---

## 15. Architectural Debt

No aplica — sistema greenfield.

**Riesgo potencial identificado desde especificaciones:**
- La generación de `NumeroConsecutivo` requiere control de concurrencia estricto desde el inicio para evitar duplicados. Si se implementa como un simple contador en la base de datos sin locking adecuado, se puede introducir deuda desde el día uno.
- El aislamiento multi-tenant debe ser parte del schema desde la primera migración. Añadirlo retrospectivamente es costoso y riesgoso.

---

## 16. Security Risks

No hay código, por lo tanto no hay riesgos de implementación. Los riesgos identificados a nivel de diseño son:

| ID | Severidad | Descripción |
|---|---|---|
| SR-01 | Critical | Credenciales PKCS#12 de Hacienda deben cifrarse at-rest. Nunca en texto plano. |
| SR-02 | Critical | API Key secrets nunca recuperables. Almacenar solo el hash. |
| SR-03 | High | Isolación multi-tenant: un tenant no puede acceder a datos de otro. |
| SR-04 | High | Secrets (DB passwords, AWS keys) nunca en código ni en logs. |
| SR-05 | Medium | Los logs de auditoría deben ser append-only e inmutables. |
| SR-06 | Medium | XAdES-EPES signing requiere acceso al certificado privado; el proceso de firma debe aislarse en un adapter con acceso mínimo. |

---

## 17. Unknowns and Assumptions

| # | Descripción | Estado |
|---|---|---|
| U-01 | Framework específico de Node.js/TypeScript (NestJS recomendado, pendiente confirmación) | **Requires clarification** |
| U-02 | ORM: Prisma vs TypeORM vs Drizzle | **Requires clarification** |
| U-03 | Queue technology: BullMQ (Redis) vs pg-boss (PostgreSQL) | **Requires clarification** |
| U-04 | Acceso a ambiente sandbox de Hacienda (ATV Staging) | **Requires clarification** |
| U-05 | Biblioteca de firma XAdES para Node.js | **Requires clarification** |
| U-06 | Secret management en producción: AWS Secrets Manager vs Parameter Store vs Vault | **Requires clarification** |
| U-07 | CI/CD: GitHub Actions asumido (pendiente confirmación de repositorio) | **Assumption** |
| U-08 | Auth de usuarios administradores desde Fase 0 o solo desde Fase 8 | **Requires clarification** |
| U-09 | Política de retención de audit logs y storage | **Requires clarification** |
| U-10 | Relación con Inventori: ¿autenticación shared o sistemas completamente independientes? | **Requires clarification** |
