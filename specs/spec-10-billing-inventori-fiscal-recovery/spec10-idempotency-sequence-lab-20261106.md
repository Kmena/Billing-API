# SPEC-10 — identidad fiscal, intentos y corte de consecutivos

Fecha: 2026-11-06. Ramas aisladas `codex/spec10-operation-attempts` (Billing) y `codex/spec10-stable-fiscal-event` (Afiliaciones). Bases de ensayo descartables; Hacienda y SMTP simulados. No se cambiaron Inventori, Billing histórico, las bases/volúmenes instalados, las claves ni los contadores persistentes. Los cinco contenedores SPEC-09 permanecieron detenidos al cierre.

## Implementación y límites

| Control | Implementación |
| --- | --- |
| Identificador interno | Billing conserva `operationId` UUID de la reserva v2 y añade `internalOperationId` estable con timestamp de creación, primer actor M2M y UUID de reserva. Es ajeno a la clave y al consecutivo fiscal. La rotación de clave no cambia ese identificador. |
| Clave de idempotencia | Afiliaciones crea para **nuevos** outboxes `AFFILIATIONS:{companyId}:{paymentId}:FE`. El valor se guarda una vez en su outbox; reintentos y reinicios lo reutilizan. Los outboxes ya persistidos mantienen sus claves anteriores `payment-{paymentId}`. No se migran ni se reenvían. |
| Auditoría de intento | Cada creación/replay que alcanza una reserva v2 crea una fila `fiscal-v2.operation.attempt` bajo bloqueo de esa reserva. Incluye número monotónico de intento, actor M2M, correlation ID, timestamp, HTTP y resultado/código seguro. El estado fiscal se consigna `NOT_CHECKED_BY_CREATE_OPERATION`; aceptación exige la submission oficial. Un crash puede dejar `STARTED`, lo que identifica un intento interrumpido. Los rechazos previos a la reserva quedan en la auditoría HTTP normal, fuera de este ledger. |
| Auditoría de consecutivo | El evento transaccional `fiscal-v2.document.created` ahora conserva emisor por asociación, sucursal, terminal, tipo, valor numérico y consecutivo. No se registran secretos ni tokens. |
| Contador | La implementación existente ya usa `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` en la **misma transacción** de creación, con índice único por compañía/ambiente/punto/tipo y `@@unique` de consecutivo documental. El mismo evento idempotente devuelve el documento original. No se modificó ese asignador ni su esquema. |
| Reconciliación | `planSequenceCutover` es una función pura, de solo lectura, por identidad legal/ambiente/punto/tipo. Calcula un piso conocido a partir de documentos, reservas y `next_value`; devuelve `authorizedNextValue=null` si no están cerradas las fuentes externas o la colisión histórica. Rechaza dimensiones mezcladas y fuentes duplicadas. No aplica valores a PostgreSQL. |
| Correlación Afiliaciones | La API envía `X-Correlation-Id` por intento de outbox, lee el nuevo identificador interno opcional y usa la misma correlación en su auditoría local. El aprobador humano consta en la aprobación local; el principal fiscal de Billing sigue siendo la identidad M2M autorizada. |

No se creó un contador por timestamp. El cambio de contrato `internalOperationId` está documentado en `docs/contracts/billing-w2-b2-lab.v2.openapi.yaml` y `billing-w3-a-corrective-lab.v2.openapi.yaml`. Las rutas siguen registradas solo en el módulo de laboratorio; esta rama no activa emisión productiva.

## Evidencia local reproducible

```powershell
# Billing: migraciones y HTTP sobre PostgreSQL descartable
node scripts/test-safety/disposable-postgres.mjs run -- node scripts/test-safety/run-disposable-validation.mjs e2e w2-b2-persistent-invoice.e2e-spec.ts
node scripts/test-safety/disposable-postgres.mjs run -- node scripts/test-safety/run-disposable-validation.mjs e2e w3-a-corrective-lab.e2e-spec.ts
npm test -- --runInBand src/modules/fiscal-documents/domain/__tests__/sequence-cutover-plan.spec.ts
npm run typecheck
npm run build

# Afiliaciones: desde Billing; ruta de worktree aislado de Afiliaciones
$env:SPEC10_CONTINUOUS_E2E='1'
$env:SPEC09_MEMBERSHIP_CROSS_TEST='1'
$env:SPEC08_W2B_TEST_FILTER='apps/api/test/spec09-membership-cross.test.ts'
$env:USE_REAL_HACIENDA='false'
node scripts/test-safety/disposable-postgres.mjs run -- node 'C:\Users\kmena\.codex\worktrees\spec09-docker-frontend-candidate\Aflilientions\scripts\run-spec09-full-regression.cjs'
```

Resultados: Billing FE/TE HTTP **21/21**; Billing NC/ND/cancelación HTTP **26/26**; planificador **3/3**. Afiliaciones→Billing HTTP **2/2**, con autoaprobación 403 y segundo usuario 200, un documento tras timeout/reintento, POST mock 202 y GET mock `ACCEPTED`, una submission con un intento de envío y una consulta, PDF + XML firmado + respuesta presentes y una sola entrega del paquete. El correo fue simulado; se observó además un correo simulado separado para la respuesta fiscal. Afiliaciones restauró 28 migraciones en descarte y reportó `schemaDrift=false`. Typecheck, lint de archivos modificados y build de Billing y API Afiliaciones pasaron. Los tests de firma/XSD usan certificado sintético. Ninguna de estas respuestas proviene de Hacienda real.

La prueba de corte sintetizó histórico 1–7 y SPEC-09 número 1. Resultado `knownNextFloor=8`, `authorizedNextValue=null` por fuentes externas no cerradas y colisión no resuelta. Una fuente sintética adicional con reserva 11 elevó el piso a 12 al certificar ambas condiciones en el test; esto demuestra el cálculo, **no** autoriza 8 ni 12 en la instalación.

## Preparación operativa; sin instalación

El preflight anterior `spec10-affiliations-stag-preparation-20261106.md` identificó cinco contenedores SPEC-09 detenidos, un certificado y conexión SANDBOX configurados, una asociación M2M activa y la FE anterior en `MANUAL_REVIEW_REQUIRED`. Las imágenes instaladas carecen del paquete automático v2 y la clave activa de Afiliaciones carece de `fiscal-v2:deliveries:request`. Al cierre de esta wave los mismos cinco contenedores siguen detenidos. No se iniciaron: su arranque requiere controlar workers y envíos. La factura anterior, su XML y su consecutivo no se usaron.

No existe una obligación limpia impaga seleccionada para una factura nueva. El fixture nuevo de obligación, pago SINPE y evidencia solo existe en la base descartable del E2E; no se preparó un pago persistente ni se aprobó uno real. Correo real, STAG automático y producción siguen apagados.

## Runbook de instalación y una factura posterior — no ejecutado

1. Solicitar autorización separada para instalar ambos commits. Confirmar árbol/imagen/commit, salud, ausencia de workers fiscales concurrentes y compatibilidad M2M. Capturar huellas; respaldar ambas bases, almacén fiscal y claves, restaurar en aislamiento y confirmar rollback.
2. Congelar ambos escritores fiscales. Reconciliar por **identidad legal** y dimensión todas las fuentes (dos Billing, Inventori como ledger de referencia y cualquier sistema externo autorizado), incluyendo aceptados, rechazados, pendientes y reservas. Resolver documentalmente la colisión del número 1. Si una fuente falta o cambia, detener; el piso 8 no basta.
3. Ensayar en clon el valor de corte aprobado y el bloqueo transaccional. Con autorización específica, asignar el contador único en la autoridad Billing elegida, verificar que la otra instalación ya no emite y que no hay saltos hacia atrás. No renumerar ni borrar documentos.
4. Instalar Billing y luego Afiliaciones compatibles, sin activar Hacienda. Rotar M2M con solapamiento para añadir solo el scope de paquete; verificar consumidores antes de revocar. Probar replays, concurrencia, FE/NC/ND, firma/XSD, tres artefactos, aislamiento y huellas.
5. Con autorización posterior para crear el caso, elegir una nueva obligación de laboratorio, registrar un pago SINPE con evidencia y referencia única, y dejarlo pendiente. Verificar receptor, período, monto, impuestos, actividad, CABYS, cuenta, destinatario de entrega y ausencia de intención previa. Un segundo usuario debe aprobarlo. No reutilizar el pago/factura en revisión manual.
6. Solicitar **otra autorización independiente** para el primer contacto STAG, con IDs del nuevo pago y obligación. Confirmar endpoint/IDP STAG, certificado, OAuth y secuencia aprobada. Crear una sola FE; ejecutar a lo sumo un POST. HTTP 202 es ambiguo en el contrato actual, no aceptación. Reconciliar por GET de la misma clave con límites explícitos, sin repetir POST por timeout.
7. Persistir estado concluyente o revisión manual. Solo si `ind-estado=aceptado`, exigir PDF, XML firmado y respuesta oficial íntegros; solicitar paquete una vez y verificar entrega con SMTP **simulado**. Cotejar huellas y contadores. Correo real requeriría otra autorización.

## Gates

| Gate | Estado |
| --- | --- |
| `INTERNAL_OPERATION_ID` | `PASS_LAB` |
| `STABLE_IDEMPOTENCY_KEY` | `PASS_LAB` |
| `ATTEMPT_AUDIT` | `PASS_LAB` para operaciones con reserva; rechazo previo a reserva fuera del ledger de intento |
| `ATOMIC_FISCAL_SEQUENCE` | `PASS_LAB` en una base compartida |
| `SEQUENCE_COLLISION_PREVENTION` | `PASS_LAB` en una base; `BLOCKED_REAL` entre instalaciones |
| `AFFILIATIONS_M2M_V2` | `PASS_LAB`, `NOT_RUN_INSTALLED` |
| `AFFILIATIONS_E2E` | `PASS_LAB_SIMULATED` |
| `PDF_XML_RESPONSE_DELIVERY` | `PASS_LAB_SIMULATED`, aún no instalada |
| `STAG_SEQUENCE_READY` | `BLOCKED` |
| `STAG_REAL_TEST_READY` | `BLOCKED` |

Ningún gate de Hacienda real pasó. La evidencia de aceptación simulada no prueba que STAG vaya a aceptar una factura.
