# Flujo histórico verificable

## Versión y evidencia

`04e7f1e40b86775aba88601a878ea5efe7b4b7c6` cerró F4-S. El registro sanitizado TASK-009-STATUS del 2026-09-23T00:18:29Z muestra: POST previo HTTP 202; estado `POST_OUTCOME_UNKNOWN`; un GET HTTP 200; `ind-estado=aceptado`; `Mensaje=1`; respuesta XML presente; estado Billing `ACCEPTED`; cero solicitudes productivas. Su SHA-256 coincide con el consignado en `spec.md`. El documento de esa prueba fue `314b07f5-8d56-4973-a6a3-1a280905eb07` y no es la factura SPEC-09 en revisión manual.

`test/hacienda-sandbox/scenarios/task-009-fe-submission.ts` llama a `FiscalDocumentService.createDocument`, `PrepareFiscalXmlService.execute` y `FiscalSubmissionWorkerService.handleSubmitJob`, que usa `HaciendaRecepcionAdapter`. `task-009-status-query.ts` usa la conciliación GET. El informe histórico indica XML v4.4, XSD, firma XAdES-EPES con P12, OAuth STAG `rut-stag`/`api-stag`, POST y GET en `https://api-sandbox.comprobanteselectronicos.go.cr/recepcion/v1`. HTTP 202 fue resultado de recepción para procesamiento, **no aceptación**. La aceptación se obtuvo solo después del GET.

El informe tiene una sección anterior que aún dice “TASK-009 live pending”; su cierre superior y el artefacto sanitizado posterior acreditan la ejecución. La integración F4 de artefactos/entrega con ese documento fue diferida. No se encontró evidencia directa de que Inventori inició ese documento F4-S ni de entrega SMTP. El flujo de Inventori sí existe en código y pruebas de contrato, pero no se debe elevar esa evidencia a aceptación externa completa.

## Diagrama

```mermaid
sequenceDiagram
    participant I as Inventori API / worker
    participant B as Billing v1
    participant DB as Billing PostgreSQL / almacenes
    participant H as Hacienda STAG
    participant M as Entrega Billing
    I->>B: X-API-Key, idempotencia: crear factura
    B->>DB: reservar consecutivo y clave; persistir documento
    I->>B: preparar XML
    B->>DB: XML v4.4, XSD, firma XAdES con P12
    I->>B: solicitar envío
    B->>H: OAuth STAG; POST /recepcion (XML firmado)
    H-->>B: HTTP 202
    B->>DB: POST_OUTCOME_UNKNOWN
    B->>H: GET /recepcion/{clave}
    H-->>B: HTTP 200, ind-estado=aceptado, respuesta-xml
    B->>DB: ACCEPTED y artefacto de respuesta
    B-->>I: estado y artefactos consultables
    Note over M: Entrega con este documento F4-S no observada
```

El primer tramo Inventori del diagrama refleja **el contrato implementado**, no un origen demostrado para el documento F4-S aceptado. Inventori `src/services/billing-api-client.service.js` usa rutas v1 de crear, preparar, enviar, consultar estado y descargar artefactos. `fiscal-billing-worker.service.js` reclama la intención, fija hash e idempotencia y evita recrear si ya tiene `billingFiscalDocumentId`. Billing conserva la autoridad sobre XML, consecutivo, firma, estado y artefactos.

## Fallos históricamente corregidos

El informe F4-S registra correcciones del sobre `clave/fecha/emisor/receptor/comprobanteXml`, estructura XAdES, identidad emisor/certificado, actividad económica, CAByS, totales e IVA. Son parte del componente reutilizable; volver a implementar el transporte fiscal en Inventori o Afiliaciones reabriría estos errores.
