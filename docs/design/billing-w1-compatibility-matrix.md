# W1 · matriz de compatibilidad Inventori v1 / consumidores v2

**Estado:** PROPUESTO. Fuente v1: [inventario W0 del cliente fijado](../contracts/inventori-v1-inventory-w0.md), commit Inventori `edb1e05186d296e3699c71306913f16aee470d1e`. Las 42 combinaciones verbo/ruta siguen bajo `/api/v1`; `/api/v2` se agrega sin alias, redirecciones ni headers nuevos en v1.

| Grupo v1 | Pares fijados | Comportamiento v1 que permanece | Equivalente v2 propuesto / wave | Regresión obligatoria |
|---|---:|---|---|---|
| Onboarding legado | 4 | Status, credenciales y readiness con rutas/scopes actuales | Readiness mínimo v2; configuración fiscal conserva autoridad administrativa separada | Cliente fijado y códigos de error. |
| Bootstrap v1 | 1 | `inventori-bootstrap-v1`, retorno de clave una vez y asociación histórica | Alta de consumidor/asociación con JWT tenant admin; sin bootstrap de cobros | Replay, secreto no expuesto. |
| Actividades v1 | 4 | Lectura, refresh y selección del emisor | W1 no concede edición al perfil afiliaciones ordinario | Catálogo y permisos Inventori intactos. |
| Estado/prueba v1 | 3 | Readiness y prueba SANDBOX con semántica existente | `GET /api/v2/companies/{companyId}/fiscal-readiness/{environment}`; sin test invoice v2 en W1 | Readiness antes de emitir, no aceptación inferida. |
| Emisor/perfil v1 | 4 | `GET/PATCH issuer`, `GET/PUT profile` bajo clave Inventori | Lectura limitada futura; escritura solo rol administrativo explícito | Ninguna ampliación de scopes de afiliaciones. |
| Conexión/certificado v1 | 7 | Secretos write-only, cert safe metadata, permisos actuales | Sin endpoint de credenciales/certificados para clave ordinaria v2 | No exposición de secreto/PIN por v2. |
| Sucursales/terminales/secuencias v1 | 9 | Numeración y configuración v1 intactas | Configuración del emisor compartida por autoridad fiscal, no por consumidor | Misma secuencia legal para un emisor, sin asignación W1. |
| Ciclo de factura v1 | 10 | Headers, cuerpos, errores, hash `fiscal-payload-equivalence.v1`, lookup y artefactos actuales | Emisión/lectura de documento v2 en W2; lookup v2 por namespace en W1 | E2E cliente real, golden hash INV-966, no acceso v1 a documentos v2 ajenos. |
| **Total** | **42** | | | |

## Invariantes transversales

| Dimensión | v1 Inventori | v2 propuesto | Prueba que detecta ruptura |
|---|---|---|---|
| URL | `/api/v1` global actual; 42 pares verbos/rutas | Router `/api/v2` separado | Test de registro efectivo de rutas; no doble prefijo ni shadowing. |
| Principal | API key `inventori-fiscal-v1` o bootstrap; JWT admin para alta | API key `affiliations-fiscal-v1` con binding a asociación, JWT admin para gestión | Clave v1 rechazada en v2; clave v2 rechazada en v1. |
| Empresa/ambiente | `ApiKeyCompany` y TEST/SANDBOX, LIVE/PRODUCTION | Binding v2 único; mismas equivalencias de ambiente | Negativos cruzados de tenant, empresa y ambiente. |
| Asociación | `FiscalIntegrationAssociation.companyId @unique` | `FiscalConsumerAssociation` adicional permite segundo consumidor | Inventori lee su asociación sin cambio; nueva alta no la sobrescribe. |
| Idempotencia | `FiscalIdempotencyKey` única por tenant/empresa/operación/key | Tabla v2 única por asociación/ambiente/operación/key | Misma key en apps distintas no colisiona; rotación interna conserva replay. |
| Hash | Canonización v1 y snapshots históricos intactos | `fiscal-payload.v2` separado y aún bloqueado por W2 | Golden fixture v1 no cambia; vectors v2 independientes. |
| Documento | Histórico v1 con origen nulo | Nuevo v2 con `originConsumerId` y asociación | Lectura/artefacto/submission por ID filtra origen; 404 uniforme. |
| Errores | Códigos/cuerpos actuales | Envelope v2 propio, correlación y retryable | Contract diff v1 y fixtures v2 por código. |
| Estados | Documento, submission y delivery separados | Misma separación más estado de reserva v2 | `201/202` local nunca se interpreta como Hacienda `ACCEPTED`. |
| Eventos | Polling actual, sin feed saliente de consumidores | Feed/outbox en W5; W1 no lo simula como garantía | Contrato v2 W1 no promete notificaciones inexistentes. |

### Matriz negativa mínima W1

Para cada ruta de lectura/lookup y alta: probar tenant ajeno, empresa no vinculada, ambiente incorrecto, consumidor ajeno en empresa compartida, asociación suspendida, clave revocada/expirada, scope insuficiente, perfil v1 en v2 y perfil v2 en v1. Para rutas por ID repetir sobre documento, XML, submission, artefacto y entrega; `404` no debe distinguir “no existe” de “pertenece a otro origen”. Un administrador con privilegio fiscal explícito se prueba por separado: no se asume que una API key ordinaria herede esa excepción.

El E2E Inventori fijado de W0 cubrió un recorrido real, pero **no prueba los 42 pares individualmente**. W1 debe generar un catálogo de métodos/rutas/scopes del proveedor y compararlo con el inventario del consumidor; además debe ejecutar el cliente real en PostgreSQL descartable. Cualquier cambio de respuesta o permiso v1 exige estrategia de compatibilidad y revisión explícita, no actualización silenciosa del golden fixture.
