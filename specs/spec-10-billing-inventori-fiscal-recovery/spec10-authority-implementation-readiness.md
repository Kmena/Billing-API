# SPEC-10 — cierre de autoridad y preparación de implementación

Actualización: el ensayo posterior de contador compartido v1/v2, la lectura de bytes del archivo histórico y el paquete PDF/XML/respuesta están en `spec10-unified-closure-evidence.md`. Los controles de corte persistente y automatización v2 siguen pendientes; el estado global continúa `NO`.

Fecha: 2026-11-06. Ramas de laboratorio: Billing `codex/spec10-authority-reconciliation`; Afiliaciones `codex/spec10-affiliations-e2e`. No se instalaron imágenes, no se migraron bases persistentes, no se contactó Hacienda y no se usaron secretos reales. Este informe complementa `authority-sequence-reconciliation.md` y `e2e-fiscal-acceptance.md`.

Tras el apagado del equipo, se comprobó de nuevo que el Billing histórico arrancó `healthy`, mientras que los contenedores persistentes SPEC-09 permanecían detenidos. No se iniciaron ni alteraron. Se repitieron en PostgreSQL descartable `fiscal-submission-continuity` (15/15), el recorrido Inventori (1/1) y el recorrido Afiliaciones (2/2); el `typecheck` de ambas API, ESLint de los archivos Billing modificados y `npm run lint` de Afiliaciones pasaron. Esto valida la candidata de laboratorio, no la salud actual de la instalación SPEC-09 detenida.

## Estado de controles

| Control | Estado | Evidencia y límite |
| --- | --- | --- |
| `DATA_AUTHORITY_PROPOSED` | **PASS** | Código y futura base SPEC-09 propuestos para emisión nueva; base histórica de Inventori preservada como archivo fiscal de lectura. No hay corte autorizado. |
| `SEQUENCE_RECONCILIATION_READY` | **PARTIAL** | Dimensión por identidad legal/ambiente/sucursal/terminal/tipo definida; mínimo candidato 8 para la única FE observada. Falta probar el máximo usado fuera de ambas bases y la operación administrativa de elevación transaccional. |
| `HISTORICAL_DOCUMENTS_PRESERVED` | **PARTIAL** | Las 3 FE históricas aceptadas y la FE SPEC-09 en revisión manual se observaron intactas, sin claves ni consecutivos repetidos. Falta ensayo de recuperación integral de archivos, referencias y claves de ambos almacenes. |
| `MIGRATION_DIVERGENCE_CLASSIFIED` | **PARTIAL** | Migración `20261103000000_fix_idempotency_api_key_rotation` aplicada solo en histórico, checksum documentado; SQL exacto no recuperado. Ambos índices finales de unicidad coinciden. No se copió ni editó el ledger. |
| `INVENTORI_E2E_SIMULATED` | **PASS (LAB)** | Cliente HTTP real de Inventori, una FE, XML/XSD/firma sintéticos, POST mock 202, GET mock aceptado, PDF/XML y respuesta en correo capturado; 1/1. No es prueba real de Hacienda. |
| `AFFILIATIONS_E2E_SIMULATED` | **PARTIAL (LAB)** | Dos bases tmpfs y app actual: SINPE con captura, autoaprobación 403, segundo usuario, factura única firmada, POST mock 202, GET mock aceptado, respuesta por correo capturado; 2/2. Falta PDF/XML en **ese mismo** envío. |
| `NC_ND_REGRESSION` | **PASS (LAB limitado)** | 26/26 pruebas W3: NC total/parcial/remanente, ND permitidas, referencias, concurrencia y DF-06 bloqueado. No equivale a aceptación fiscal externa de NC/ND. |
| `SPEC10_READY_FOR_IMPLEMENTATION` | **NO** | Persisten riesgos de colisión de contador en dos escritores, conservación de artefactos históricos y entrega completa v2. Preparar esas waves antes de autorizar implementación o corte. |

## Comprobaciones ejecutadas

- Solo lectura sobre `billing-postgres` y `spec09-billing-postgres-1`: 1 emisor fiscal coincidente; 3/1 documentos exclusivos; consecutivos históricos 5–7 y SPEC-09 1, sin colisión actual; contador 7→8 frente a 1→2. Histórica: 6 reservas idempotentes completadas, 3 sin documento; 7 certificados registrados, 1 activo. SPEC-09: 1 activo con la misma huella. Códigos de actividad, sucursal y terminal coinciden. Las seis entregas históricas están `DELIVERED` con ocho intentos; no se infiere integridad de archivo de ese estado.
- Billing F4-S unitario: **10 suites, 396/396**. `fiscal-submission-continuity`: **15/15** en PG descartable. `w2-b2-persistent-invoice`: **17/17** en PG descartable. `w3-a-corrective-lab`: **26/26** en PG descartable. `accepted-fiscal-package-resend`: **12/12** en PG descartable.
- Inventori real HTTP client con Billing descartable: `fiscal-onboarding-wave8-integration.e2e-spec.ts` **1/1**, con aserciones nuevas de una sola llamada POST, una GET, código de recepción mock 202 y entregas capturadas que incluyen PDF/XML y respuesta.
- Afiliaciones actual con dos PG tmpfs: `spec09-membership-cross.test.ts` **2/2**. Un documento `ACCEPTED`, submission `ACCEPTED`, una llamada POST mock 202, una consulta GET mock, un correo simulado de respuesta; artefactos `SIGNED_XML` y `HACIENDA_RESPONSE_XML`. Restauración descartable: 28 migraciones, 1 empresa y 2 movimientos coincidentes; deriva de esquema ausente. El test también prueba recuperación de un fallo sintético tras crear el documento, idempotencia y rechazo de autoaprobación.
- Cliente Prisma local regenerado desde `schema.prisma` porque los tipos instalados estaban obsoletos; luego Billing `typecheck`, `build` y ESLint de los archivos modificados pasaron. Afiliaciones API `typecheck`, `build` y ESLint del fixture modificado pasaron. No se ejecutó Prisma sobre bases instaladas.

## Reproducción segura

Desde la raíz Billing de una rama aislada, con `node_modules` instalado y Docker Desktop activo. El runner verifica su marca de seguridad y elimina sus contenedores tmpfs; no aceptar una URL de base persistente. Nunca activar el runner real de Hacienda.

```powershell
$env:INVENTORI_BILLING_CLIENT_PATH='C:\Users\kmena\Documents\proyectos\inventory-api\inventory-api\src\services\billing-api-client.service.js'
npm run test:e2e:disposable -- fiscal-onboarding-wave8-integration.e2e-spec.ts
npm run test:e2e:disposable -- fiscal-submission-continuity.e2e-spec.ts
npm run test:e2e:disposable -- w2-b2-persistent-invoice.e2e-spec.ts
npm run test:e2e:disposable -- w3-a-corrective-lab.e2e-spec.ts
npm run test:e2e:disposable -- accepted-fiscal-package-resend.e2e-spec.ts
npm run test:hacienda-sandbox:unit
```

Para el recorrido actual Afiliaciones, usar el checkout aislado de `codex/spec10-affiliations-e2e`; sustituir `<RAIZ_AFILIACIONES>` solo por su ruta local. La bandera SPEC-10 obliga al fixture exacto, mock Hacienda y `EMAIL_USE_REAL=false`; no solicita credenciales fiscales.

```powershell
$env:SPEC09_MEMBERSHIP_CROSS_TEST='1'
$env:SPEC10_CONTINUOUS_E2E='1'
$env:SPEC08_W2B_TEST_FILTER='apps/api/test/spec09-membership-cross.test.ts'
node scripts/test-safety/disposable-postgres.mjs run -- node '<RAIZ_AFILIACIONES>\scripts\run-spec09-full-regression.cjs'
```

La prueba usa el adaptador Hacienda simulado existente; el status de respuesta mock solo adquiere `ACCEPTED` tras GET. El mock ahora permite devolver 202 para este ensayo sin alterar su valor por defecto de 201 en otras suites. Los adjuntos simulados se inspeccionaron por nombres y estados; no se envió correo real. El fixture antiguo W5 falla por un contrato de pago obsoleto y queda fuera del modo SPEC-10; las pruebas NC/ND se ejecutaron separadamente y constan arriba.

## Waves y decisiones pendientes

1. **Conservación histórica:** ensayar restore conjunto de ambas bases, artefactos y claves; mapear cada documento, XML, respuesta y entrega a su origen. Probar lectura histórica de Inventori tras cambiar la autoridad de nueva emisión. No copiar secretos entre almacenes.
2. **Contador único:** demostrar el máximo fiscal real por dimensión, investigar reservas sin documento, congelar ambos escritores, implementar operación transaccional auditada para fijar `safe_next`, probar concurrencia v1/v2 y rechazo de un segundo escritor. El mínimo observado 8 no es autorización de asignación.
3. **Entrega v2 completa:** producir PDF conforme a la política vigente, reunir XML firmado y respuesta aceptada de la misma FE, probar integridad y una sola entrega capturada. Mantener el estado de correo separado del estado fiscal.
4. **Notas:** conservar NC/ND de laboratorio y el bloqueo DF-06. Diseñar y probar POST/GET simulados por nota dentro de contratos aprobados; un dictamen fiscal posterior decide escenarios no cubiertos.
5. **Migración histórica:** conservar el checksum aplicado y documentar la proveniencia faltante; ensayar en restauraciones el camino elegido sin reescribir el ledger ni inventar el SQL. Si se propone la base histórica como destino, exigir revisión DBA adicional.
6. **Transición:** mantener v1 y v2, scopes/empresa/ambiente, idempotencia y auditoría; evitar contraseñas administrativas nuevas en emisión ordinaria. El corte STAG real y la producción requieren autorizaciones distintas. La factura en `MANUAL_REVIEW_REQUIRED` permanece fuera de cualquier reintento.

Decisiones de operador antes de implementar: aprobar la base SPEC-09 como futura autoridad física; definir retención y acceso a la base histórica; aceptar el plan de contador único y el procedimiento de respaldo/recuperación conjunto. No se solicita autorización de despliegue con este informe.
