# Billing W1 — cierre de integración en laboratorio

**Rama:** `codex/billing-w1-d2-lab`. **Base:** `ab65429bff3d26f1806d974114a162c9ec666127`. Esta acta registra únicamente cambios W1 posteriores a la base. ADR-BIL-011/012 siguen propuestos; no autoriza DDL objetivo, montaje operativo, merge ni despliegue.

## Cambios acreditados

- `FiscalConsumersLabModule` registra los seis contratos HTTP de consumidores v2 solo cuando el laboratorio lo importa explícitamente. `AppModule` no lo importa. Readiness siempre bloquea emisión fiscal y lookup solo consulta reservas sintéticas preexistentes.
- Alta/lectura, emisión y revocación exigen JWT de administrador del tenant. El guard M2M valida Argon2id, perfil v2, binding, tenant, empresa, ambiente, estado y scope mínimo por ruta; rechaza prefijo test/live incongruente. La consulta de consumidor no proyecta secretos.
- La asociación administra `consumerId` estable y mapeo de empresa independiente del ambiente. El catálogo de proveedores permitido es **sintético de laboratorio**, no un catálogo operativo aprobado. La revocación y emisión comprueban además el `consumerId` de la ruta.
- Rotación: máximo dos claves activas en una ventana explícita de hasta 24 horas **solo como límite de laboratorio**. La expiración, duración máxima de clave y política de retención operativa requieren decisión de Seguridad. La clave cruda se entrega una sola vez y no entra en auditoría.
- La respuesta de registro distingue 201 nuevo de 200 replay; GET no devuelve secreto; la revocación es 204. El OpenAPI v2 propuesto refleja la envoltura de error HTTP real. No se cambió ningún contrato ni implementación Inventori v1.

## Pruebas ejecutadas

| Gate | Resultado | Alcance |
|---|---|---|
| Contratos W1 | 33/33, 6 suites, PASS | OpenAPI, 42 pares v1, perfil, scopes y esquema de errores. |
| Unidad completa | 1338/1338, 117 suites, 13 omisiones de suites separadas, PASS | Incluye XAdES; una corrida verde no explica la falla histórica. |
| XAdES focal | 40/40, PASS | Se conserva `result.error` en el fallo del verificador independiente para la próxima reproducción; no se alteró la firma ni el criterio. |
| Seguridad | 35/35 y verificación estática PASS | Guardas y seguridad de tests. |
| Concurrencia DB | 12/12, 2 suites, PASS | PostgreSQL 15 descartable. |
| Migraciones | 25/25 aplicadas, PASS | Exclusivamente a PostgreSQL 15 descartable; incluye W1-D2. |
| HTTP W1 | 2/2, PASS | App de test con módulo W1 explícito, JWT real de test, aislamiento, revocación, idempotencia y v1 coexistente. |
| Typecheck, lint, build | PASS | Lint con 26 advertencias preexistentes, 0 errores. |
| E2E completo | 164/164, 28 suites, PASS | Cliente Inventori fijado por CI en `edb1e05186d296e3699c71306913f16aee470d1e`, SHA-256 `1bc069fa657569ce3c489b633775adea8ba362bbe3c3f19e0051209c88ea9da0`; PostgreSQL descartable. |

La primera corrida E2E de esta revisión falló por dos supuestos de harness: faltaba la copia local del cliente Inventori fijado por CI y un test W1 contaba filas v1 **globales** tras otras suites. Se extrajeron los bytes exactos del commit fijado sin modificar Inventori; la aserción ahora cuenta solo los tenants creados por ese test. La segunda corrida completa pasó sobre una base descartable nueva. Los mensajes asíncronos de PDF después del teardown persisten como ruido del harness pese al PASS y deben examinarse si afectan una futura prueba operativa.

## Actualización desde `main`, preparada y no ejecutada

1. Proponer únicamente este commit W1 para integración; revisar que el diff no incluya W2, Inventori ni rutas v1. Las propuestas ADR conservan estado `NO APROBADA`.
2. Antes de mover `main`, repetir CI de `.github/workflows/ci.yml` y `npm run test:w1:d0` en el SHA exacto: lint, typecheck, unidad, safety, build, E2E con cliente Inventori fijado y PostgreSQL descartable. Integrar solo con autorización de merge y sin alterar historial concurrente.
3. Para una futura actualización de Billing, fijar ese SHA de `main` como imagen/artefacto, comprobar el ledger objetivo y la compatibilidad del binario con el esquema existente. Con gate W1 apagado, verificar salud y los 42 contratos v1. DDL W1 requiere preflight DBA, restauración representativa y autorización separados; las rutas v2 permanecen fuera de `AppModule` hasta una activación expresamente aprobada.

Este mecanismo aprovecha el CI existente. No configura un despliegue automático ni modifica la base objetivo.

## Gates pendientes

- **Base objetivo:** no se consultó. El DBA debe ejecutar el preflight de solo lectura, resolver 16 divergencias históricas y evaluar locks/cardinalidades del SQL W1 sobre una restauración representativa antes de solicitar DDL real.
- **Arquitectura y Seguridad:** ADR-BIL-011/012, DP-01, proveedor real, vida/rotación de clave y retención no están aprobados. No se crean vínculos a emisores reales.
- **XAdES:** la falla histórica independiente `xml-crypto` carece de error/XML/semilla preservados. El fallo XSD observado dentro del sandbox corresponde a `EPERM` al crear Python; no prueba rechazo del XML. Mantener el gate y capturar evidencia sanitizada si reaparece en runner apto.

**Estados:** `W1_LAB_INTEGRATION_PASS=PASS`; `W1_TARGET_DB_READINESS=NOT_READY`; `W1_STAGING_READINESS=NOT_READY`; `W1_PRODUCTION_READINESS=NOT_READY`.
