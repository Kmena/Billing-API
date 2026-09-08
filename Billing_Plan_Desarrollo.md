# Billing --- Plan de Desarrollo API-First

## 1. Objetivo

Construir **Billing** como un producto SaaS independiente para
facturación electrónica en Costa Rica, consumible tanto por
**Inventori** como por POS, ERP, e-commerce y otros sistemas externos.

El desarrollo será **API-first**: las primeras versiones se enfocarán en
ofrecer una API segura para consultar información de Hacienda y
posteriormente emitir, consultar y administrar comprobantes
electrónicos, antes de construir la interfaz completa de Billing.

## 2. Arquitectura objetivo

Billing utilizará una arquitectura de **Monolito Modular + Procesamiento
Asíncrono**.

No se utilizarán microservicios inicialmente.

### Principios

-   Un único codebase.
-   Módulos de dominio claramente separados.
-   Arquitectura hexagonal / separación Domain, Application e
    Infrastructure.
-   PostgreSQL como base de datos principal.
-   Procesamiento síncrono para consultas que requieren respuesta
    inmediata.
-   Queue + workers para operaciones largas, reintentos e integraciones.
-   Object Storage para XML, PDF y respuestas de Hacienda.
-   Multi-tenant desde el inicio.
-   API versionada.
-   Auditoría e idempotencia.
-   Posibilidad de escalar API y workers independientemente sin
    convertirlos en microservicios.

### Vista general

``` text
Inventori / POS / ERP / E-commerce
                |
                | REST API
                v
+---------------------------------------------+
|               BILLING                      |
|            MONOLITO MODULAR                |
|                                             |
|  Capa síncrona                             |
|  +---------------------------------------+  |
|  | API / Controllers                     |  |
|  | Application / Use Cases               |  |
|  | Domain                                |  |
|  +---------------------------------------+  |
|                                             |
|  Módulos                                    |
|  - Identity / Tenants                       |
|  - Companies                                |
|  - API Keys                                 |
|  - Taxpayers                                |
|  - CABYS                                    |
|  - Tax Rules                                |
|  - Fiscal Documents                         |
|  - Purchases                                |
|  - Payments / Receipts                      |
|  - Documents                                |
|  - Notifications                            |
|  - Webhooks                                 |
|  - Audit                                    |
|                                             |
|               Job / Event                   |
|                    |                        |
|                    v                        |
|  Capa asíncrona                             |
|  +---------------------------------------+  |
|  | Workers / Jobs                       |  |
|  | - Hacienda submission               |  |
|  | - Hacienda status                   |  |
|  | - Retries                           |  |
|  | - PDF                               |  |
|  | - Email                             |  |
|  | - Webhooks                          |  |
|  | - Received document processing      |  |
|  +---------------------------------------+  |
+-------------+-------------------------------+
              |
       +------+-------+---------------+
       |              |               |
   PostgreSQL       Queue       Object Storage
                      |
                      v
                   Hacienda
```

El API y el worker pueden ejecutarse como procesos independientes del
**mismo código**:

``` text
billing-api     -> HTTP/API
billing-worker  -> Background jobs
```

Esto permite posteriormente levantar múltiples instancias de cada
proceso según la carga.

------------------------------------------------------------------------

# 3. Roadmap

## Fase 0 --- Foundation

### Objetivo

Construir la base técnica de Billing sin implementar todavía el ciclo
completo de facturación.

### Alcance

-   Backend independiente de Inventori.
-   PostgreSQL.
-   Migraciones.
-   Multi-tenancy.
-   Tenant.
-   Company.
-   User.
-   Roles y permisos base.
-   API Key model.
-   Configuración por ambiente.
-   Manejo centralizado de errores.
-   Logging estructurado.
-   Correlation ID.
-   Audit Log.
-   OpenAPI / Swagger.
-   API versionada bajo `/api/v1`.
-   Docker.
-   CI/CD.
-   Health checks.
-   Infraestructura base de queue/workers.
-   Abstracción de Object Storage.
-   Separación de módulos y capas.

### Resultado

Billing existe como aplicación independiente y dispone de una base
segura y extensible para API y procesamiento asíncrono.

------------------------------------------------------------------------

## Fase 1 --- API Keys + consultas públicas de Hacienda

### Objetivo

Crear la primera versión utilizable de Billing.

Un sistema externo podrá autenticarse mediante API Key y utilizar
Billing como gateway normalizado hacia servicios públicos de Hacienda.

Billing todavía no necesita emitir facturas.

### API Keys

Capacidades:

``` http
POST   /api/v1/api-keys
GET    /api/v1/api-keys
DELETE /api/v1/api-keys/{id}
```

Scopes iniciales:

``` text
taxpayers:read
cabys:read
exchange-rates:read
```

Cada API Key debe estar asociada a una integración y a las compañías
explícitamente autorizadas.

El secreto completo debe mostrarse una sola vez y almacenarse de manera
no recuperable.

### Auditoría API

Registrar como mínimo:

-   API Key / Integration ID.
-   Tenant.
-   Company.
-   Endpoint/acción.
-   Timestamp.
-   HTTP result.
-   IP cuando esté disponible.
-   Correlation/Request ID.
-   Duración.
-   Error cuando corresponda.

### Consulta de contribuyentes

``` http
GET /api/v1/taxpayers/{identification}
```

Billing consulta Hacienda y devuelve un contrato propio y estable.

Ejemplo conceptual:

``` json
{
  "identification": "3101123456",
  "name": "EMPRESA ABC S.A.",
  "status": "ACTIVE",
  "taxRegime": "...",
  "economicActivities": []
}
```

Billing no debe exponer directamente el contrato interno de Hacienda.

### CABYS

``` http
GET /api/v1/cabys/{code}
GET /api/v1/cabys?search=...
```

### Tipo de cambio

``` http
GET /api/v1/exchange-rates
```

Debe conservarse fuente y fecha cuando la información se utilice
posteriormente en documentos fiscales.

### Caché

Incorporar caché donde sea apropiado para:

-   Reducir llamadas innecesarias.
-   Respetar límites de Hacienda.
-   Mejorar latencia.
-   Aumentar resiliencia.

### Resultado

Inventori u otro sistema puede conectarse mediante API Key y consultar
información fiscal pública a través de Billing.

------------------------------------------------------------------------

## Fase 2 --- Conexión de cada empresa con Hacienda

### Objetivo

Permitir que cada compañía configure sus propias credenciales para las
operaciones autenticadas con Hacienda.

Billing nunca utilizará unas credenciales fiscales globales para
representar a todos los clientes.

### Modelo conceptual

``` text
Company
   |
   +-- HaciendaConnection
       - credentials/secrets
       - certificate/configuration
       - environment
       - status
       - lastVerifiedAt
```

### Seguridad

-   Secretos cifrados at-rest.
-   Nunca registrar secretos en logs.
-   Nunca devolver credenciales completas por API.
-   Rotación.
-   Auditoría.
-   Separación TEST/PRODUCTION.
-   Acceso de mínimo privilegio.
-   Secret Manager cuando corresponda.

### API administrativa

``` http
POST /api/v1/companies/{id}/hacienda-connection
GET  /api/v1/companies/{id}/hacienda-connection/status
POST /api/v1/companies/{id}/hacienda-connection/test
```

### Resultado

Cada empresa puede conectar y verificar de manera segura su
configuración de Hacienda.

------------------------------------------------------------------------

## Fase 3 --- Emisión de comprobantes por API

### Objetivo

Permitir que cualquier sistema autorizado facture utilizando Billing sin
implementar directamente la integración con Hacienda.

### Endpoint principal

``` http
POST /api/v1/fiscal-documents
```

### Tipos iniciales

Prioridad inicial:

1.  Factura Electrónica.
2.  Tiquete Electrónico.
3.  Nota de Crédito.
4.  Nota de Débito.

Posteriormente:

5.  Factura Electrónica de Compra.
6.  Factura Electrónica de Exportación.

### Pipeline

``` text
Request
   |
   v
API Key + Authorization
   |
   v
Company validation
   |
   v
Input validation
   |
   v
Tax Rules
   |
   v
Consecutive / Key
   |
   v
Persist document
   |
   v
Create async job
```

### Idempotencia

Las operaciones de escritura fiscal deberán aceptar:

``` http
Idempotency-Key: ...
```

La misma operación reenviada por timeout/retry no debe crear un segundo
comprobante.

Una misma key utilizada con un payload diferente debe producir error.

### Resultado

Un sistema externo puede solicitar la creación de un comprobante
electrónico mediante la API de Billing.

------------------------------------------------------------------------

## Fase 4 --- Procesamiento asíncrono con Hacienda

### Objetivo

Separar la respuesta HTTP del procesamiento potencialmente lento o
inestable de Hacienda.

### Flujo

``` text
POST /fiscal-documents
        |
        v
Validate + Persist
        |
        v
Create Job
        |
        +------> 202 Accepted
                    |
                    v
              documentId
```

Worker:

``` text
Job
 |
 v
Generate XML
 |
 v
Sign
 |
 v
Send Hacienda
 |
 v
PROCESSING / WAITING_HACIENDA
 |
 +--> ACCEPTED
 |
 +--> REJECTED
 |
 +--> RETRY / ERROR
```

### Consulta

``` http
GET /api/v1/fiscal-documents/{id}
```

### Webhooks

Eventos iniciales:

``` text
document.accepted
document.rejected
document.processing_failed
```

Los webhooks deberán:

-   Estar firmados.
-   Tener identificador de evento.
-   Tener reintentos.
-   Ser auditables.
-   Tolerar que el consumidor procese el mismo evento más de una vez.

### Worker

Implementar:

-   Retry.
-   Backoff.
-   Recuperación de jobs.
-   Manejo de errores transitorios.
-   Correlation ID.
-   Historial de intentos.

### Resultado

La indisponibilidad o latencia de Hacienda no bloquea las solicitudes
HTTP ni obliga al consumidor a mantener conexiones largas.

------------------------------------------------------------------------

## Fase 5 --- XML, PDF, almacenamiento y entrega

### Objetivo

Completar el ciclo documental después del procesamiento fiscal.

### Flujo

``` text
Hacienda ACCEPTED
       |
       v
Signed XML
       |
       +--> Hacienda Response XML
       |
       +--> PDF
       |
       +--> Object Storage
       |
       +--> Email Job
```

### API

``` http
GET  /api/v1/fiscal-documents/{id}
GET  /api/v1/fiscal-documents/{id}/xml
GET  /api/v1/fiscal-documents/{id}/pdf
GET  /api/v1/fiscal-documents/{id}/hacienda-response
POST /api/v1/fiscal-documents/{id}/send
```

### Requisitos

-   Archivos privados.
-   Descargas autorizadas por tenant/company.
-   Política de retención.
-   Integridad documental.
-   Estado fiscal separado del estado de entrega.
-   Email asíncrono con reintentos.

### Resultado

Billing conserva y entrega los artefactos asociados al comprobante
electrónico.

------------------------------------------------------------------------

## Fase 6 --- Recepción de documentos, compras y gastos

### Objetivo

Agregar el flujo de documentos recibidos y compras.

### API

``` http
POST /api/v1/received-documents
GET  /api/v1/received-documents/{id}

POST /api/v1/expenses
GET  /api/v1/expenses
GET  /api/v1/expenses/{id}
```

### Procesamiento XML

Al recibir un XML:

``` text
XML
 |
 v
Parse
 |
 v
Validate
 |
 +--> Issuer
 +--> Identification
 +--> Key / Consecutive
 +--> Date
 +--> Currency
 +--> Lines
 +--> CABYS
 +--> Taxes
 +--> Discounts
 +--> Totals
```

Validar duplicados y pertenencia del receptor cuando corresponda.

### Régimen Simplificado

El diseño debe permitir:

-   Identificar régimen del proveedor.
-   Registrar evidencia/documento soporte.
-   Factura Electrónica de Compra cuando legalmente corresponda.
-   Clasificación de compras por tasa.
-   Reglas fiscales versionadas.

No asumir que todo proveedor de régimen simplificado requiere
automáticamente una Factura Electrónica de Compra.

### Resultado

Billing puede registrar y procesar documentos recibidos, compras y
gastos.

------------------------------------------------------------------------

## Fase 7 --- Pagos, recibos e integración con cuentas por cobrar

### Objetivo

Integrar el ciclo financiero de facturas a crédito sin duplicar la
responsabilidad de Inventori.

### Relación conceptual

``` text
Invoice
   |
   +--> Account Receivable (Inventori / consuming system)
            |
            +--> Payment
                    |
                    +--> Receipt
```

### API

``` http
POST /api/v1/payments
GET  /api/v1/payments/{id}

GET  /api/v1/receipts/{id}
GET  /api/v1/receipts/{id}/pdf
POST /api/v1/receipts/{id}/send
```

### Requisitos

-   Pagos parciales.
-   Pagos totales.
-   Idempotencia.
-   Referencia a factura.
-   Saldo restante.
-   Método de pago.
-   Moneda.
-   Referencia/evidencia cuando aplique.
-   Auditoría.

### Resultado

Inventori puede administrar cuentas por cobrar mientras Billing
administra los documentos y recibos asociados mediante una integración
desacoplada.

------------------------------------------------------------------------

## Fase 8 --- UI administrativa mínima

### Objetivo

Proporcionar una interfaz para configurar y operar técnicamente Billing
sin construir todavía toda la experiencia de facturación standalone.

### Funcionalidades

-   Login.
-   Empresa.
-   Hacienda.
-   API Keys.
-   Integraciones.
-   Usuarios.
-   Documentos.
-   Actividad/auditoría.
-   Errores.
-   Descarga XML/PDF.
-   Reenvío de documentos.

### Resultado

Billing puede administrarse sin depender de operaciones manuales en base
de datos o configuración del servidor.

------------------------------------------------------------------------

## Fase 9 --- Billing Standalone

### Objetivo

Permitir que una empresa utilice Billing directamente sin Inventori ni
otro sistema externo.

### Navegación propuesta

``` text
                     [+ Factura]

Inicio

VENTAS
  Facturas
  Proformas
  Cuentas por cobrar

COMPRAS
  Compras / Gastos
  Proveedores

ANÁLISIS
  Reportes

CONEXIONES
  Integraciones
  Desarrolladores

CONFIGURACIÓN
  Empresa
  Hacienda
  Usuarios
  Suscripción
```

### Principio UX

El usuario debe poder iniciar una factura desde cualquier pantalla.

Clientes y productos guardados son ayudas de productividad, no
requisitos obligatorios para iniciar una factura.

### Resultado

Billing funciona como producto de facturación independiente además de
funcionar como plataforma/API.

------------------------------------------------------------------------

## Fase 10 --- Reportes y automatización

### Alcance

-   Ventas.
-   Compras.
-   Impuestos.
-   Cuentas por cobrar.
-   Pagos.
-   Régimen Simplificado.
-   Documentos aceptados/rechazados/pendientes.
-   FEC.
-   Tiquetes.
-   Exportación.
-   Excel.
-   PDF.
-   CSV/JSON mediante API.
-   Dashboard.
-   Recepción automática de documentos.
-   Automatizaciones.
-   Métricas de API.
-   Consumo por API Key.
-   Límites según suscripción.

------------------------------------------------------------------------

# 4. Resumen de entregas

  Fase   Entrega principal                            UI
  ------ -------------------------------------------- -----------------
  0      Foundation + arquitectura + multi-tenant     No
  1      API Keys + consultas Hacienda/CABYS          No
  2      Credenciales/conexión Hacienda por empresa   Mínima/opcional
  3      Crear comprobantes por API                   No
  4      Procesamiento asíncrono + webhooks           No
  5      XML + PDF + correo                           No
  6      Recepción + compras/gastos + RTS             No
  7      Pagos + recibos + integración AR             No
  8      UI administrativa                            Sí
  9      Billing standalone                           Sí
  10     Reportes + automatización                    Sí

# 5. Milestones

## Milestone 1 --- Billing Public Fiscal API

> Cualquier sistema autorizado puede utilizar una API Key de Billing
> para consultar información fiscal pública necesaria para sus
> operaciones.

Incluye principalmente:

-   Taxpayer lookup.
-   Actividades económicas.
-   Régimen.
-   CABYS.
-   Tipo de cambio cuando corresponda.

## Milestone 2 --- Billing Fiscal API

> Cualquier sistema autorizado puede emitir y consultar comprobantes
> electrónicos sin implementar directamente la integración con Hacienda.

Incluye:

-   Document creation.
-   Hacienda submission.
-   Status.
-   Idempotency.
-   Async processing.
-   Webhooks.
-   XML.
-   PDF.

## Milestone 3 --- Billing Fiscal Platform

> Billing administra emisión, recepción, documentos, pagos y conexiones
> fiscales como plataforma consumible por otros sistemas.

## Milestone 4 --- Billing Standalone

> Una empresa puede utilizar Billing directamente como su sistema de
> facturación sin requerir Inventori u otro software externo.

------------------------------------------------------------------------

# 6. Frontera Billing / Inventori

La responsabilidad debe permanecer explícita.

## Billing

Responsable de:

-   Integración con Hacienda.
-   Información fiscal.
-   CABYS.
-   Tax Rules.
-   Comprobantes electrónicos.
-   XML.
-   Firma.
-   Estado Hacienda.
-   PDF.
-   Entrega documental.
-   Facturas recibidas.
-   Documentos fiscales de compra.
-   Pagos/recibos cuando correspondan.
-   API y webhooks fiscales.

## Inventori

Responsable de:

-   Existencias.
-   Bodegas.
-   Lotes.
-   Movimientos físicos.
-   Producción.
-   Fórmulas.
-   QA.
-   Non-Conformance/Rework.
-   Merma.
-   Costeo y valoración de inventario.
-   Recepción física.
-   Cuentas por cobrar operativas.

Una factura de compra no implica automáticamente una recepción física y
una nota de crédito no implica automáticamente un retorno de inventario.

Los sistemas se relacionan mediante IDs/referencias, API y eventos, sin
compartir responsabilidad sobre el mismo agregado.

------------------------------------------------------------------------

# 7. Principios no negociables

1.  **API-first.**
2.  **Monolito modular, no microservicios inicialmente.**
3.  **Procesamiento asíncrono donde aporta resiliencia.**
4.  **Consultas inmediatas pueden permanecer síncronas.**
5.  **Multi-tenant desde el inicio.**
6.  **API Keys con scopes y autorización por compañía.**
7.  **Idempotencia en operaciones fiscales y financieras.**
8.  **Auditabilidad completa.**
9.  **Secretos nunca almacenados ni expuestos en texto plano
    recuperable.**
10. **Contratos propios de Billing; no filtrar directamente contratos
    internos de Hacienda.**
11. **Reglas fiscales versionadas y auditables.**
12. **Billing no administra inventario físico.**
13. **Workers forman parte del mismo producto/codebase.**
14. **El diseño debe permitir escalar API y workers
    independientemente.**
15. **No introducir microservicios hasta que exista una necesidad
    técnica u organizacional demostrable.**
