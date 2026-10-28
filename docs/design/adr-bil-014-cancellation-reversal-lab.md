# ADR-BIL-014 — Anulación total, sustitución y reversión

**Estado:** decisión funcional del operador implementada en laboratorio; decisión tributaria pendiente. 2026-10-28.

## Decisión funcional

La anulación ordinaria de una factura FE aceptada solicita una NC **TOTAL** con motivo obligatorio. El original y sus artefactos permanecen intactos. La anulación comercial solo llega a `CANCELLED` al observar la aceptación fiscal de esa NC. La infraestructura de NC parcial y remanente sigue disponible únicamente en su flujo correctivo de laboratorio, fuera de esta operación ordinaria. Un documento rechazado se corrige por un flujo distinto; esta operación no crea NC sobre él.

Después de la aceptación de la NC, el consumidor puede solicitar un borrador precargado desde los snapshots del original. Puede editar el intento fiscal dentro del validador W2, pero la nueva FE solo se emite al confirmar expresamente el borrador. La nueva clave y el consecutivo pertenecen a un documento nuevo. Una observación comercial opcional se conserva en el flujo y no se incorpora al XML.

`REVERSE_CANCELLATION` requiere una NC original aceptada. Sin sustituta fiscalmente vigente, prepara una ND que referencia **directamente** esa NC. Con una sustituta aceptada, solicita primero una NC total de la sustituta, espera su aceptación y entonces prepara la ND sobre la NC original. Si la sustituta fue rechazada, no se crea NC sobre ella. La NC de la sustituta no se deshace automáticamente ante fallo de la etapa posterior.

## Límite fiscal

La emisión de esa ND está bloqueada por `BLOCKED_FISCAL_POLICY`. La [matriz DF-06](df-06-normative-matrix-2026-10-28.md) identifica `TipoDocIR=03` y `01` como **candidato normativo** para anular la NC completa, sin aprobar su aplicación tributaria. El plan compara la NC total con la FE, verifica emisor, receptor, clave, consecutivo, referencia, impuestos, totales y XML firmado, y fija un hash. Se requiere aprobación fiscal de la secuencia, importes, impuestos, estados exigibles y referencias antes de añadir el ejecutor de ND o activar `DEBIT_NOTE_PENDING`, `DEBIT_NOTE_ACCEPTED` y `REVERSAL_COMPLETED`. Tampoco se considera aceptada una NC por su XML firmado o por estar lista para envío; solo cuenta el estado fiscal terminal observado.

## Persistencia y recuperación

`FiscalCancellationWorkflow` guarda la relación original → NC → FE sustituta → NC de sustituta → ND futura, el estado, la versión, claves y hashes de idempotencia por operación, el borrador y el plan de reversión. Los índices únicos impiden dos flujos por original y la repetición de cada documento. Los bloqueos de fila protegen solicitudes concurrentes; los motores W2/W3 reutilizan reservas idempotentes y su recuperación tras interrupción. Cada transición crea un evento `FISCAL_AUDIT` en la tabla de auditoría existente. Esta auditoría es de solo anexado por la aplicación; el carácter inmutable ante un actor con acceso directo a la base requiere controles de infraestructura y DBA.

Estados implementados: `CANCEL_REQUESTED`, `CREDIT_NOTE_PENDING`, `CREDIT_NOTE_ACCEPTED`, `CANCELLED`, `REPLACEMENT_DRAFT`, `REPLACEMENT_ISSUED`, `REVERSAL_REQUESTED`, `REPLACEMENT_CANCELLATION_PENDING`, `REPLACEMENT_CANCELLATION_ACCEPTED`, `RECOVERY_REQUIRED` y `BLOCKED_FISCAL_POLICY`. Los tres estados de ND y el cierre de reversión están reservados para la decisión fiscal y no son alcanzables en este laboratorio.

## Aislamiento

El controlador está en `W3AFiscalLabModule`, que no forma parte de `AppModule`; exige `NODE_ENV=test`, ambiente SANDBOX, identidad M2M, scopes por operación y pertenencia a tenant, empresa y asociación. No agrega rutas v2 productivas ni modifica los contratos v1 de Inventori. La migración se aplica y verifica solo en PostgreSQL descartable.

## Pendientes para aprobación

- Dictamen fiscal sobre reversión ND, referencia directa a NC, código, impuestos y secuencias de dos etapas.
- Política de recuperación supervisada cuando una NC sea rechazada o una etapa se interrumpa después de reservar un documento.
- Validación DBA y autorización de STAG separadas de esta decisión funcional.
