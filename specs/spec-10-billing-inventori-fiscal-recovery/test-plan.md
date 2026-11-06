# Pruebas, resultados y límites

## Ejecutado el 2026-11-06

| Control | Ejecución | Resultado |
| --- | --- | --- |
| F4-S sin red | `npm run test:hacienda-sandbox:unit -- --silent` | 10 suites, **396/396 PASS**. Incluye guard, auth simulado, POST y GET simulados, evidencia sanitizada. |
| Cliente Inventori sin red | En el checkout de Inventori, `node --test --test-isolation=none tests/afpr006-billing-api-client.test.js tests/billing-api-client-wave6b.test.js tests/billing-api-client-fiscal-onboarding.test.js` | **37/37 PASS**. Contratos v1, credencial server-side y errores seguros. No inició su API ni DB y no modificó Inventori. El primer intento con aislamiento por proceso falló `spawn EPERM` por el sandbox local; la repetición sin spawn pasó. |
| PostgreSQL descartable | `node scripts/test-safety/disposable-postgres.mjs run -- node scripts/test-safety/run-disposable-validation.mjs e2e 'fiscal-xml-signing|fiscal-submission-continuity|accepted-fiscal-package-resend'` | Contenedor `billing-p0-p0aa889fdaad0a`, `postgres:15-alpine`, tmpfs, 32/32 migraciones; **3 suites, 30/30 PASS**; contenedor y storage descartados por el guard. Certificados/datos sintéticos, `USE_REAL_HACIENDA=false`. |
| Inventario instalado | `docker ps -a`, `docker inspect` con nombres de variables y allowlist no secreta | Dos Billing y dos PostgreSQL confirmados. Sin cambios a contenedores o bases persistentes. |
| Evidencia histórica | SHA256 + campos permitidos de `task-009-status-1790122709729.json` | SHA coincide; POST previo 202, GET 200, `aceptado`, estado Billing ACCEPTED; 0 POST en la corrida de consulta y 0 solicitudes productivas. |

Las tres suites E2E prueban módulos **por separado**. `fiscal-submission-continuity` sí cubre factura API→XML→firma→envío simulado→GET→ACCEPTED y persistencia; `accepted-fiscal-package-resend` usa un paquete ACCEPTED sembrado, no el generado por la primera suite. En la corrida aparecieron mensajes de tareas PDF posteriores al cierre de Jest (`Test environment has been torn down`), aunque todas las aserciones pasaron. No se declara una prueba continua de entrega Inventori→Billing→SMTP. El mock de Hacienda no equivale a aceptación externa nueva.

## Suite requerida antes de implementación operativa

1. Levantar Inventori y Billing en redes/PG descartables; no usar bases, certificados ni secretos instalados. Usar `X-API-Key` v1 con empresa y scopes de prueba. Crear una sola intención y factura sintéticas.
2. Fijar `Idempotency-Key`, hash de payload y correlación. Crear, preparar XML v4.4, validar XSD y firma P12 sintética. Verificar una sola clave y consecutivo.
3. Interceptar HTTP de OAuth y recepción en servidor local: token sintético, POST exactamente una vez con host/headers/body esperados; devolver 202. Mantener `POST_OUTCOME_UNKNOWN`.
4. Simular GET `ind-estado=aceptado` y `respuesta-xml`; comprobar transición persistida a ACCEPTED, integridad de artefactos, PDF y paquete de correo en adaptador capturador (sin SMTP externo).
5. Reiniciar workers aislados antes y después de cada etapa; verificar recuperación sin doble POST/correo. Probar timeout, 400/403, estado ambiguo, rechazo, certificado/identidad incorrecta, token inválido, respuestas truncadas, claves revocadas, permisos insuficientes, empresa ajena y ambiente incorrecto.
6. Repetir con contrato v2 de Afiliaciones, conservando exactamente el mismo pipeline Billing. Verificar que onboarding y emisión tienen scopes distintos.
7. Cerrar handlers de PDF/colas antes del teardown; exigir cero tareas vivas al final. Documentar resultados y huellas sin valores secretos.

Las pruebas futuras no habilitan Hacienda ni correo real. Un POST 202 simulado prueba la máquina de estados, no autorización fiscal externa.
