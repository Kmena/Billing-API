# SPEC-10 — contador compartido, archivo histórico y paquete fiscal

Fecha: 2026-11-06. Ramas aisladas: `codex/spec10-unified-sequence-and-delivery` (Billing) y `codex/spec10-complete-affiliations-delivery` (Afiliaciones). Todas las escrituras de prueba ocurrieron en PostgreSQL descartable; Hacienda y correo fueron simulados. No se inició ni modificó el Billing SPEC-09 persistente.

## Contador único

La base candidata SPEC-09 ya usa un `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` dentro de la transacción fiscal, con clave `(tenant_id, company_id, environment, branch_code, terminal_code, document_type)`. Se añadió una prueba HTTP con dos solicitudes v1 de Inventori y dos v2 de Afiliaciones concurrentes contra **la misma base y empresa Billing**. Las cuatro recibieron números consecutivos distintos; el reintento v1 reutilizó su documento y no avanzó el contador. La suite v2 también cubre recuperación tras interrupción, reintentos concurrentes y rotación de clave. La suite F2 de concurrencia ya cubre rollback y fallo transaccional.

Esto demuestra la autoridad local compartida cuando ambos consumidores usan la misma `(tenant, company, ambiente, punto, tipo)`. **No demuestra todavía un corte seguro de dos bases persistentes:** el máximo observado para la FE `SANDBOX/001/00001` es 7 en Inventori y 1 en SPEC-09, pero las reservas históricas sin documento, cualquier emisión externa y el avance posterior al inventario deben investigarse. El mínimo candidato 8 no se instalará por inferencia. También debe impedirse que dos tenants Billing distintos representen el mismo emisor fiscal durante la emisión. Se requiere inmovilizar ambos escritores, capturar un snapshot nuevo, demostrar el máximo por dimensión, probar una elevación transaccional auditada del contador y mover ambos consumidores a una sola autoridad antes de liberar emisión.

## Inventario verificable de documentos históricos

Consulta de solo lectura en `billing-postgres` y lectura de objetos desde `billing-api`, con SHA-256 calculado en memoria. No se imprimieron bytes, claves fiscales, rutas de almacenamiento ni digestos. La base histórica contiene tres FE aceptadas y ninguna NC/ND. Cada referencia de XML firmado, PDF y respuesta fiscal se leyó y coincidió con su huella almacenada.

| Documento histórico | Tipo | Estado | Consecutivo numérico | XML firmado | PDF | Respuesta |
| --- | --- | --- | ---: | --- | --- | --- |
| `19d3a71f-386e-49c8-9f17-29bab925b806` | FE | ACCEPTED | 5 | MATCH | MATCH | MATCH |
| `3eb5ce42-be1a-4eaa-acb4-39cc7ae29659` | FE | ACCEPTED | 6 | MATCH | MATCH | MATCH |
| `ebb658c2-4d70-4719-8f02-d52afbacd539` | FE | ACCEPTED | 7 | MATCH | MATCH | MATCH |

Las tres claves y los tres consecutivos son únicos dentro del archivo histórico. La FE SPEC-09 en `MANUAL_REVIEW_REQUIRED` permanece separada e inmóvil; sus referencias se inventariaron antes, pero sus bytes no se verificaron en esta ejecución porque sus contenedores persistentes están detenidos. No hay notas históricas instaladas para reconstruir referencias FE/NC/ND. La consulta futura desde un único Billing requiere un adaptador de archivo de solo lectura, con identidad `(instalación de origen, id de documento)`, acceso al almacén histórico y sus claves, y pruebas de recuperación integral. **El archivo no puede retirarse ni fusionarse todavía.**

## Entrega de Afiliaciones en laboratorio

El recorrido usa Afiliaciones HTTP real, aprobación por segundo usuario, un Billing, XML firmado, POST mock 202, GET mock aceptado y un único documento. Se identificó que el `MensajeHacienda` del mock carecía de namespace y `<Mensaje>1</Mensaje>`; el preflight correcto del paquete lo rechazaba. Se corrigió **solo el mock**, conservando `ind-estado` como autoridad para la transición fiscal. El runner espera explícitamente la generación PDF y solicita el paquete aceptado por el endpoint existente, con una clave sintética autorizada. El correo capturado del paquete contiene exactamente la misma clave para `.pdf`, `.xml` y `_respuesta.xml`. Un pedido duplicado devuelve 429; no crea otra entrega.

El flujo actual requiere esa solicitud explícita de paquete tras la aceptación; Afiliaciones v2 aún no dispara por sí sola un paquete completo. Por eso el ensayo integral es **PASS de laboratorio orquestado**, mientras que la automatización operativa sigue **PARTIAL**. No se permite activar correo real basándose en este ensayo. El hook de entrega inicial del XML ahora espera sus tareas pendientes al cerrar la aplicación, evitando que una tarea PDF continúe después del cierre de la prueba; la ruta v2 de laboratorio desactiva ese hook y el runner espera su PDF directamente.

## Pruebas y estados

| Control | Estado | Evidencia / límite |
| --- | --- | --- |
| `UNIFIED_SEQUENCE_AUTHORITY` | PARTIAL | Un contador compartido probado en una base; corte de dos bases y guardia por emisor/tenant pendientes. |
| `SEQUENCE_COLLISION_TEST` | PASS (LAB) | v1/v2 concurrentes 4/4, cuatro claves y consecutivos distintos, reintento sin avance; suite v2 18/18. |
| `HISTORICAL_ARTIFACTS_PRESERVED` | PARTIAL | 3/3 FE históricas con XML, PDF y respuesta `MATCH`; acceso unificado y restore del archivo pendientes. |
| `INVENTORI_E2E_CONTINUOUS` | PASS (LAB) | Cliente HTTP Inventori 1/1; POST/GET y correo simulados. |
| `AFFILIATIONS_E2E_CONTINUOUS` | PARTIAL | Afiliaciones 2/2 y paquete completo en ensayo orquestado; falta disparador v2 automático. |
| `PDF_XML_RESPONSE_DELIVERY` | PASS (LAB) | Los tres adjuntos de la misma FE en un correo mock; duplicado 429. |
| `NC_ND_REGRESSION` | PASS (LAB) | 26/26; restricciones DF-06 preservadas. |
| `SPEC10_READY_FOR_IMPLEMENTATION` | NO | Faltan corte de contador seguro, lectura/restore histórico unificado y automatización de paquete v2. |

Regresiones relacionadas: F3 15/15, Inventori 1/1, W2-B2 18/18, W3-A/B 26/26 y Afiliaciones 2/2 con dos bases tmpfs y restauración sin deriva (28 migraciones). Billing `typecheck` y lint de archivos modificados; Afiliaciones `lint` y API `typecheck` se verifican antes del commit. No hubo tráfico a Hacienda ni SMTP real.
