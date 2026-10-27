# Billing W2-B — evidencia de proyección fiscal en laboratorio

**Base:** `147d662`; rama `codex/billing-w2-b-lab`. **Cierre:** `W2_B_FISCAL_ENGINE_LAB_PASS=PARTIAL`. Ninguna ruta fiscal v2 está registrada, no hay emisión desde v2, enlace documental v2, datos de emisores reales, conexión a Hacienda real, merge o despliegue.

| Gate solicitado | Estado del corte |
|---|---|
| `W2_B_FISCAL_ENGINE_LAB_PASS` | `PARTIAL`: proyección y XML sintéticos; falta flujo persistente de creación y recuperación. |
| `W2_B_XML_XSD_VALIDATION` | `PASS_LAB_SYNTHETIC`: escenarios acotados y XML firmado. |
| `W2_B_SIGNATURE_VALIDATION` | `PASS_LAB_SYNTHETIC`: XAdES firmado/verificado con certificado de prueba. |
| `W2_B_IDEMPOTENCY_VALIDATION` | `PARTIAL`: hash golden y decisiones W1 puras; no reserva/documento v2. |
| `W2_B_INVENTORI_COMPATIBILITY` | `PASS_LAB`: 42 pares v1 protegidos, 39/39 contratos y cliente fijado en E2E 165/165. |
| `W2_B_TAX_DECISIONS_PENDING` | `YES`: ADR-BIL-013/016, DP-02 y DF aplicables sin aprobación formal. |
| `W2_B_PRODUCTION_READINESS` | `NOT_READY`: W1 integración, DBA, STAG y decisiones fiscales pendientes. |

## Alcance realizado

| Área | Evidencia | Límite |
|---|---|---|
| Intención y aritmética | Adaptador puro desde DTO W2-A; líneas ordenadas, bruto, descuento, neto, IVA declarado contrastado y consolidación exacta con `bigint`; CABYS 13 dígitos y unidad conocida | Un tributo y hasta un descuento por línea; cinco decimales de importe y tres de cantidad; rechazo de redondeos implícitos. |
| Representación XML | Reutiliza serializador FE v4.4 de Billing y valida XSD oficial tras firmar: una y dos líneas gravadas, patrón exento, mixto y descuento | Pruebas con fixtures sintéticos; no comprueban elegibilidad tributaria ni aceptación de Hacienda. |
| Firma | Reutiliza `NodeXadesEpesSignerAdapter`, verifica firma y XSD sobre XML firmado con certificado sintético | Sin certificado de emisor ni envío. |
| Origen y hash | `w2-b-fiscal-lab.v1`, origen M2M confiable, contenido/total por línea, referencias opacas y replay/conflicto/lookup W1 puro | No es `fiscal-payload.v2`; no se persiste en reserva fiscal. |
| Contrato y v1 | OpenAPI v2 permanece `proposed-inactive`; código nuevo no se importa en `AppModule`; archivo de contrato v1 y rutas no alterados | No hay operaciones HTTP fiscales v2. |

Los patrones 13% código `08` y exento código `10` figuran en la nota 8.1 del [anexo oficial v4.4](https://www.hacienda.go.cr/docs/ANEXOS_Y_ESTRUCTURAS_V4.4.pdf). La nota limita el código exento a su fundamento legal; la prueba solo verifica serialización. El [comunicado oficial de actualización](https://www.hacienda.go.cr/docs/ActualizacionAnexosyEstructurasVersion4.4CEv2.pdf) exige revisar el paquete normativo antes de congelar T07. Ningún test convierte un patrón XML en dictamen fiscal.

## Matriz de compatibilidad Inventori

| Superficie | Resultado técnico | Prueba |
|---|---|---|
| 42 pares verbo/ruta v1 | Sin cambios en controlador, DTO, permisos o semántica v1 | `npm run test:w1:d0`, inventario y snapshots W0. |
| FE/TE XML v1 | Serializador reutilizado sin editarlo | Suite `inventori-p0-fiscal-compatibility.spec.ts`. |
| Cliente Inventori fijado | Se debe ejecutar con `INVENTORI_BILLING_CLIENT_PATH` explícito en este worktree | `npm run test:e2e:disposable`, escenario Wave 8. |
| API v2 | No registrada en `AppModule` | Contrato W2-B y revisión del módulo. |

## Gates pendientes

1. ADR-BIL-013 debe aprobar snapshot, precisión, redondeo, orden y `fiscal-payload.v2`; ADR-BIL-016/DF-06 deben fijar XSD/catálogos actuales por hash. DP-02 y DF-01–03 deben validar granularidad, hecho fiscal y tratamiento por emisor. ADR-BIL-011/012 y DP-01 siguen sin aprobación formal.
2. W1 solo permite scopes de lectura en el laboratorio. Se necesita scope fiscal de creación, autorización de asociación, reserva y documento en una transacción, enlace de origen, estados y recuperación de interrupciones. La reserva sintética W1 no se ha convertido en reserva fiscal.
3. El serializador actual no puede representar múltiples impuestos o descuentos por línea sin ampliación del motor, pruebas XSD y política fiscal aprobada; tampoco medios múltiples, referencias fiscales o documentos alternos. El adaptador rechaza estas entradas antes de generar XML.
4. Las 16 divergencias del esquema efectivo y revisión DBA de la base objetivo, STAG por escenario y autorización productiva permanecen pendientes.

## Validación reproducible

Resultados reproducibles del corte:

| Gate | Resultado |
|---|---|
| Proyección, XML/XSD firmado, XAdES, hash y negativos | 10/10; snapshot golden 1/1. |
| Contratos W1/W2 y v1 Inventori | 39/39, 8 suites. |
| Unidad completa | 1.363 aprobadas, 13 omitidas preexistentes, 119 suites aprobadas. |
| Build, tipos y lint | Build y tipos PASS; lint 0 errores, 26 advertencias previas. |
| Seguridad estática | `TEST_SAFETY_STATIC_CHECK=PASS`. |
| E2E PostgreSQL descartable | Primera corrida: 164/165; único fallo de entorno por ruta no fijada del cliente Inventori en este worktree. Segunda corrida con `INVENTORI_BILLING_CLIENT_PATH`: 28 suites, 165/165; 25 migraciones aplicadas solo a DB descartable. |

Comandos:

```powershell
npm test -- --runInBand --runTestsByPath src/modules/fiscal-intent-v2/__tests__/w2-b-lab-projection.spec.ts
npm run test:w1:d0
npm test -- --runInBand
npm run typecheck
npm run build
npm run lint:check
$env:INVENTORI_BILLING_CLIENT_PATH='C:\Users\kmena\AppData\Local\Temp\billing-inventori-client-edb1e051.js'
npm run test:e2e:disposable
```

No ejecutar W2-C/W3, DDL real, activación v2, merge ni despliegue a partir de este corte.
