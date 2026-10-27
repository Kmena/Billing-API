# W3-A — NC/ND en laboratorio aislado

**Base:** `8bf1b5d`; rama `codex/billing-w3-a-lab`. Código aditivo y exclusivo de `NODE_ENV=test`/`SANDBOX`; `W3AFiscalLabModule` no está importado por `AppModule`. No se ejecutó DDL en bases reales, ni se usaron emisores reales o Hacienda, ni se hizo merge o despliegue.

## Alcance funcional

| Área | Implementación verificable | Límite |
|---|---|---|
| NC total | Referencia FE original, cantidad íntegra por línea, importes, XML, firma y persistencia. | Una anulación total tras NC parcial se rechaza; la regla fiscal requiere ADR-BIL-014/DF-06. |
| NC parcial | Cantidad por línea de FE original; descuento proporcional y cálculo decimal exactos; bloqueo del original y ledger de NC no rechazadas. | La reserva conservadora no usa ND previas para ampliar saldo, ni representa tratamientos fiscales aún no aprobados. |
| ND | Ajuste de base por línea existente con la misma tarifa IVA 13 % o exenta de la FE original. | Política jurídica de ND y alcance de ajustes pendiente; no se interpreta saldo comercial. |
| Original | Mismo tenant, empresa, consumidor, asociación y ambiente; emisor identificado igual al snapshot; estado `ACCEPTED`; XML original firmado y XSD válido. | `ACCEPTED` se fija sintéticamente en la prueba descartable; no es aceptación de Hacienda. |
| Idempotencia | Namespace por asociación/ambiente/operación/clave, hash versionado `w3-a-corrective-lab.v1`, reserva y documento transaccionales. Se bloquea el original para serializar correcciones distintas. | La vinculación con estados oficiales de NC/ND espera integración W3/W6. |
| Recuperación | Reintento tras reserva, documento o XML; consulta por documento propio y lookup de operación con hash obligatorio; 404 para hash incorrecto. | Sin `submit` a Hacienda ni entrega/PDF de NC/ND. |

La identidad comercial `externalCorrectionId` y `commercialReference` permanecen opacas. Billing persiste el documento fiscal y la referencia al original; Inventori conserva sus obligaciones y pagos. No se modifica ninguna ruta, credencial ni reserva v1. Dos operaciones con distinto `Idempotency-Key` y el mismo `externalCorrectionId` sobre el mismo original se rechazan bajo el bloqueo del original.

## Fuente fiscal y gate normativo

Las [estructuras oficiales v4.4 de Hacienda](https://www.hacienda.go.cr/docs/ANEXOS_Y_ESTRUCTURAS_V4.4.pdf), sección `InformacionReferencia`, requieren `TipoDocIR`, clave, fecha, código y razón para NC/ND. Su nota 9 describe `01` para anulación y `02` para corrección de monto. La [comunicación oficial de actualización v4.4](https://www.hacienda.go.cr/docs/ActualizacionAnexosyEstructurasVersion4.4CEv2.pdf) anuncia códigos nuevos y su obligatoriedad desde el 1 de noviembre de 2026. El laboratorio usa solo `01`/`02`; no infiere la aplicabilidad de los códigos 13–17 u otros.

Los XSD de NC/ND archivados para esta prueba provienen del [repositorio espejo de esquemas](https://apis.gometa.org/4.4/hacienda/ATV/ComprobanteElectronico/docs/esquemas/2024/v4.4/), porque el CDN oficial no devolvió los bytes durante la verificación. Los namespaces oficiales constan en el [anexo publicado por PGR](https://www.pgrweb.go.cr/DOCS/NORMAS/1/VIGENTE/S/2020-2029/2020-2024/2024/1936C/1701B7.HTML). Los checksums locales son:

| Archivo | SHA-256 | Uso |
|---|---|---|
| `NotaCreditoElectronica.xsd` | `3a0142010e59126b22d42f736a0f54af38f473d59564e311deca9ee4ccc824a4` | Validación sintética NC. |
| `NotaDebitoElectronica.xsd` | `f92bf9d4b83f2da9892b5658f8b4e39347ced871bd15c03b5d6437de7bc4fe94` | Validación sintética ND. |

La copia archivada de FE difiere del XSD FE oficial ya fijado en Billing y el catálogo de códigos del espejo no incorpora todos los cambios anunciados. **Por tanto, `W3_A_XML_XSD_SIGNATURE` solo puede certificar validación de laboratorio, no vigencia oficial.** Antes de integración, DF-06 y el responsable tributario deben fijar versión, bytes y hash oficiales de NC/ND y aprobar códigos/motivos por caso.

## Esquema y compatibilidad

La migración `20261116000000_w3_a_corrective_lab` añade dos valores de enum, `source_fiscal_document_id`, `reference_snapshot`, FK e índice por original, y amplía el CHECK de operación v2. No toca la tabla de idempotencia v1. Su SHA-256 figura en `billing-w0-migration-manifest.json`. Las 16 divergencias anteriores de la base objetivo siguen pendientes de revisión DBA; el ensayo descartable no autoriza DDL objetivo.

| Superficie | Resultado esperado y evidencia |
|---|---|
| Inventori v1 | [Inventario de 42 pares](../contracts/inventori-v1-inventory-w0.md), [fixture fijado](../contracts/fixtures/inventori-v1-route-pairs.w1-d0.json) y snapshots continúan protegidos; `AppModule` no importa W3-A. |
| W2-B2 FE | `CREATE_INVOICE` conserva scope, hash, ruta y semántica; el motor común acepta especificación adicional solo en módulo de laboratorio. |
| M2M v2 | NC y ND tienen scopes específicos. Guard y transacción revalidan asociación, empresa, ambiente y clave; consulta por origen devuelve 404 a terceros. |
| Migraciones | 27 aplicadas desde cero exclusivamente en PostgreSQL descartable; el contenedor/rol/base se eliminan al cerrar el runner. |

## Pruebas reproducibles

```powershell
npx prisma generate
npm run typecheck
npm run build
npm run lint:check
npm run test:safety:static
npm run test:w1:d0 -- --silent
npm test -- --runInBand --silent
npm run test:e2e:disposable -- w3-a-corrective-lab
$env:INVENTORI_BILLING_CLIENT_PATH='C:\Users\kmena\AppData\Local\Temp\billing-inventori-client-edb1e051.js'
npm run test:e2e:disposable
```

La suite W3-A incluye NC gravada total/parcial, NC exenta parcial/total, FE mixta sintética, ND gravada/exenta, XML/XSD/XAdES, referencia fiscal, replay, conflicto de hash, identificador comercial duplicado, saldo insuficiente, dos correcciones concurrentes, reserva y documento interrumpidos, emisor y origen, original rechazado, scope, rotación, revocación y consulta con hash. La prueba de aceptación del original es explícitamente un fixture local; no se genera comprobante fiscal definitivo.

**Resultado del corte:** `npx prisma generate`, `npm run typecheck`, `npm run build` y seguridad estática PASS. `npm run lint:check`: 0 errores y 26 advertencias preexistentes. Contratos: **41/41**. Unidad completa: **1.367 aprobadas, 13 omitidas preexistentes, 0 fallidas**; la nueva proyección aporta cuatro pruebas. E2E W3 focal: **6/6**. E2E completa con el cliente Inventori fijado: **30 suites, 180/180 aprobadas**. Las 27 migraciones se aplicaron desde base vacía en el runner descartable. Los logs de errores de PDF, colisión de cola y artefacto alterado corresponden a casos negativos de suites que terminaron PASS.

## Estados y decisiones

| Gate | Estado |
|---|---|
| `W3_A_CREDIT_NOTE_LAB` | `PASS_LAB_SYNTHETIC` para FE original del subconjunto W2-B2. |
| `W3_A_DEBIT_NOTE_LAB` | `PARTIAL`: ruta y XML firmado de ajustes acotados; política fiscal ND pendiente. |
| `W3_A_PARTIAL_CORRECTIONS` | `PARTIAL`: límite por línea y concurrencia probados; total después de parcial y cómputo con ND previas pendientes. |
| `W3_A_XML_XSD_SIGNATURE` | `PARTIAL`: XSD archivados y firma válidos en laboratorio; XSD oficiales vigentes sin fijar. |
| `W3_A_IDEMPOTENCY_RECOVERY` | `PASS_LAB_SYNTHETIC` con reserva, replay, conflicto y recuperación local. |
| `W3_A_INVENTORI_COMPATIBILITY` | `PASS_LAB`: 42 pares fijados, suite de contrato v1 y E2E completa con cliente Inventori. |
| `W3_A_TAX_DECISIONS_PENDING` | `YES`: ADR-BIL-014/016, DF-06 y aprobación de tratamientos por emisor. |
| `W3_A_PRODUCTION_READINESS` | `NOT_READY`: revisión DBA, XSD oficial, dictamen fiscal, STAG por tipo y autorización productiva. |

W3-B y T09 (sustitución de documento rechazado) quedan fuera de este corte. No se aprueban automáticamente ADR ni decisiones tributarias.
