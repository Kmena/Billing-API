# SPEC-10 — Afiliaciones → Billing SPEC-09 → Hacienda STAG: preparación

Fecha: 2026-11-06. Rama aislada `codex/spec10-affiliations-stag-preparation`. Esta fase **no** contactó Hacienda, no envió correo, no inició los servicios SPEC-09 instalados y no escribió en sus bases ni volúmenes. Las consultas SQL se hicieron sobre clones PostgreSQL en `tmpfs`, sin red, con el volumen origen montado solo lectura. El ensayo continuo usó dos PostgreSQL descartables, certificado sintético y proveedor HTTP/correo simulados.

## 1. Preflight instalado

| Control | Resultado |
| --- | --- |
| Cinco contenedores SPEC-09 | Los cinco están `Exited (255)` desde unas dos horas antes del preflight. Por ello la salud HTTP instalada es `NOT_RUN`, no `PASS`. No se arrancaron por el riesgo de workers y solicitudes fiscales no autorizadas. |
| Imágenes instaladas | Billing `sha256:53b3ab7651526879346bc692ee02046b749294b1d9c26546077ac90279119626`; API Afiliaciones `sha256:6c81eacecdd4d56130818c7779482e27ce62bbd56281368868a89d7862a0f3a2`; Web `sha256:6655dc7247ad609b5f4ae9de5f0515bf3e7534e75308a3ad6a175870429ddf2c`. El SHA de origen de esas imágenes no se certificó mediante etiqueta verificable. |
| Configuración instalada | Billing: `USE_REAL_HACIENDA=false`, `BILLING_SPEC09_STAG_INVOICING=false`, `EMAIL_USE_REAL=false`, recuperación automática de entregas apagada. Afiliaciones: `BILLING_ENABLED=false`, `BILLING_MEMBERSHIP_STAG_ENABLED=false`, ambiente `SANDBOX`. Producción apunta a un destino local inoperante. |
| Host y ruta STAG configurados | Base de recepción `https://api-sandbox.comprobanteselectronicos.go.cr/recepcion/v1`; el código construye `POST /recepcion` y `GET /recepcion/{clave}`. IDP `rut-stag`. No se hizo una solicitud externa para comprobarlos. |
| Custodia y configuración fiscal | En el clon de Billing: un perfil con actividad principal; una actividad activa y habilitada; un certificado SANDBOX activo, no vencido, con referencias de certificado/PIN presentes; conexión SANDBOX `CONNECTED` con referencia de secreto; un punto de emisión por defecto activo; una asociación M2M SANDBOX activa. Esto acredita estado local, no autorización actual de Hacienda ni validez de la firma con el certificado instalado. No se leyeron secretos. |
| M2M v2 | Hay dos claves TEST activas asociadas, una con `fiscal-v2:operations:read`, `fiscal-v2:invoices:create` y `fiscal-v2:invoices:submit`. Ninguna clave instalada tiene `fiscal-v2:deliveries:request`. La identidad y autenticación en vivo no pudieron comprobarse con los servicios detenidos. |
| Código realmente instalado | Inspección offline de imágenes: Billing no contiene `fiscal-v2:deliveries:request` ni el servicio del paquete aceptado; API Afiliaciones no contiene `requestAcceptedPackage` ni la ruta de solicitud del paquete. Los worktrees de laboratorio sí los contienen, pero no están instalados. |
| Migraciones / operaciones | Clon Afiliaciones: 28 migraciones completas, un outbox fiscal `REJECTED`, tres pagos `APPROVED`, dos `REJECTED`, tres obligaciones `PENDING`. El servicio instalado está detenido; no hay worker SPEC-09 activo. Un ledger de mutación de onboarding figura abierto y debe examinarse antes de una actualización; no equivale a una emisión fiscal concurrente. |
| Factura anterior | En el clon Billing existe una sola FE `SANDBOX/001/00001/INVOICE`, número 1, `READY_TO_SUBMIT`, submission `MANUAL_REVIEW_REQUIRED`, último HTTP 403. Su XML/clave/consecutivo no se tocaron. El contador está `last_assigned=1`, `next_value=2`. |

## 2. Numeración y selección de un caso nuevo

El Billing histórico conserva FE 5–7 y evidencia de números 1–4 consumidos para el **mismo emisor, ambiente, sucursal, terminal y tipo**. El número 1 también existe en SPEC-09: colisión real de consecutivo entre instalaciones, aun cuando las claves difieren. El `next_value=2` instalado volvería a usar un número histórico. El 8 es solo un piso matemático observado, no una reserva ni un valor de corte aprobado. El inventario de fuentes externas y la decisión fiscal sobre la duplicación siguen pendientes; ver `spec10-real-sequence-archive-reconciliation-20261106.md`.

La obligación anterior `4171d591-d0ae-4a0b-8c55-e2a36c8219de` tiene un pago aplicado y una intención fiscal; no puede servir de nuevo caso. Las otras dos obligaciones `PENDING` del plan de laboratorio también tienen asignaciones de pago. **No hay una obligación limpia e impaga elegida para la nueva factura.** Para una ejecución futura se requiere crear un nuevo período/obligación y pago SINPE con evidencia, comprobar que el cliente/receptor y el plan son aptos, y aprobarlo por un segundo usuario. Esta preparación no creó registros, no aprobó pagos y no reservó números.

## 3. E2E continuo descartable

Comando reproducible, desde el worktree Billing, con el worktree Afiliaciones en `C:\Users\kmena\.codex\worktrees\spec09-docker-frontend-candidate\Aflilientions`:

```powershell
$env:SPEC10_CONTINUOUS_E2E='1'
$env:SPEC09_MEMBERSHIP_CROSS_TEST='1'
$env:SPEC08_W2B_TEST_FILTER='apps/api/test/spec09-membership-cross.test.ts'
$env:USE_REAL_HACIENDA='false'
node scripts/test-safety/disposable-postgres.mjs run -- node 'C:\Users\kmena\.codex\worktrees\spec09-docker-frontend-candidate\Aflilientions\scripts\run-spec09-full-regression.cjs'
```

Resultado 2026-11-06: 2/2 pruebas HTTP Afiliaciones aprobadas. El mismo evento creó una factura y una submission; el reintento tras interrupción reutilizó el documento. Proveedor simulado: un POST `202`, un GET con `ACCEPTED`; estado final persistido `ACCEPTED`. Artefactos `SIGNED_XML`, `HACIENDA_RESPONSE_XML`, `PDF`. Una sola entrega del paquete aceptado incluyó los tres archivos; un correo adicional de respuesta fiscal también fue **simulado**. Restauración descartable Afiliaciones: 28 migraciones, `schemaDrift=false`. La autoaprobación fue rechazada HTTP 403 y el segundo usuario aprobó. No hubo Hacienda ni SMTP reales.

Regresión directa de proyección FE, firma y XSD oficial: `npm test -- --runInBand src/modules/fiscal-intent-v2/__tests__/w2-b-lab-projection.spec.ts`: 12/12 `PASS`, incluida verificación criptográfica de firma sintética y XSD. La primera ejecución bajo sandbox falló porque Windows bloqueó el subproceso Python (`spawnSync python EPERM`); la misma suite con permiso de subproceso pasó íntegra. No se atribuye ese fallo a un defecto XML. **No se verificó el certificado instalado ni una respuesta fiscal real.**

## 4. Runbook para una ventana posterior — no ejecutado

1. Obtener autorización separada para preparar/instalar los commits compatibles de Billing y Afiliaciones. Congelar escritores fiscales, reintentos y workers de ambos Billing; inventariar contenedores y operaciones. Resolver el ledger de onboarding abierto. Tomar respaldos nuevos de ambas bases, artefactos, almacén cifrado y dependencias de clave; restaurar en aislamiento y comparar huellas.
2. Cerrar el ledger externo de numeración por identidad legal, ambiente, sucursal, terminal y tipo. Resolver la colisión del número 1 con responsable fiscal. Bajo congelamiento, capturar el máximo final utilizado/reservado y ensayar el ajuste transaccional del contador **en un clon**; luego ejecutar un corte controlado con evidencia y autorización propia. Si falta una fuente o cambia el ledger, parar. Nunca alterar la factura en revisión manual.
3. Instalar el código de paquete aceptado en Billing y Afiliaciones y provisionar `fiscal-v2:deliveries:request` mediante rotación administrativa con solapamiento. Comprobar M2M, asociación, aislamiento, idempotencia, PDF/XML/respuesta, recuperación y compatibilidad; mantener Hacienda y SMTP deshabilitados. No revocar la clave antigua antes de verificar el consumidor nuevo.
4. Crear mediante API normal una **nueva** obligación y un pago SINPE sintético con comprobante, referencia única y destinatario de entrega separado de la identidad fiscal. Comprobar receptor apto, período, monto, actividad, CABYS, impuestos, exenciones y ausencia de intención/documento previo. Registrar y aprobar con usuarios distintos. Mantener fiscal deshabilitado hasta que el preflight y los respaldos pasen.
5. Solicitar autorización independiente para el **primer contacto real** con Hacienda STAG, identificando obligación, pago, emisor, receptor y límite de solicitudes. Antes de activarlo: verificar host STAG exacto, OAuth del mismo ambiente, certificado, firma, XSD, consecutivo seguro y ausencia de otros emisores activos. Activar únicamente el caso autorizado, no la emisión general.
6. Ejecutar un solo POST para el XML firmado y persistir respuesta/identificador. La tabla oficial que usa el adaptador documenta `201`, mientras que `202` es una respuesta **no documentada** y ambigua; no probaría recepción ni aceptación por sí sola. Reconciliar por GET la **misma clave** con límites de intentos y tiempo definidos; jamás repetir POST por timeout ambiguo. Persistir `ACEPTADO`, `RECHAZADO` o revisión manual según respuesta oficial. Si no hay estado concluyente, parar sin correo ni nuevo documento.
7. Solo con aceptación concluyente, exigir PDF, XML firmado y respuesta fiscal, cotejar huellas, solicitar una entrega idempotente y verificarla con correo **simulado**. Mantener SMTP real deshabilitado. Releer documento, pago, obligación, contador y configuración fiscal; cualquier divergencia detiene la ventana y requiere recuperación controlada.

## 5. Gates

| Gate | Estado |
| --- | --- |
| `AFFILIATIONS_PAYMENT_TO_BILLING` | `PASS_LAB`; `NOT_RUN_INSTALLED` |
| `M2M_V2` | `PASS_LAB`; `PARTIAL_INSTALLED` (asociación/scopes presentes, servicios detenidos y scope de entrega ausente) |
| `XML_XSD` / `XML_SIGNATURE` | `PASS_SYNTHETIC`; certificado instalado no probado en esta fase |
| `HACIENDA_STAG_POST` / `HACIENDA_STAG_GET` / `FISCAL_STATUS` | `NOT_RUN_REAL` |
| `PDF_XML_RESPONSE_PACKAGE` | `PASS_LAB`; `NOT_INSTALLED` |
| `NO_DUPLICATE_INVOICE` | `PASS_LAB`; nueva emisión persistente bloqueada por numeración |
| `SPEC10_STAG_EXECUTION_READY` | **NO**: contenedores detenidos, flags apagados, código/scope de entrega faltantes, colisión de consecutivos y ningún caso nuevo limpio. |

La prueba real de Hacienda y la entrega simulada posterior requieren autorización independiente **después** de resolver estos bloqueos. No se solicita ni se usa aquí una contraseña administrativa adicional.
