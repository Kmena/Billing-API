# W3-B · cierre funcional de correctivos en laboratorio

**Base:** `4704f97`; rama `codex/billing-w3-b-lab`; 2026-10-27. Continuación aditiva del laboratorio W3-A. `W3AFiscalLabModule` continúa fuera de `AppModule`; ninguna ruta fiscal correctiva está activa en producción. No se usaron emisores reales, Hacienda, DDL real, merge ni despliegue.

## Cambios funcionales

La NC `REMAINING` corrige exactamente la cantidad no acreditada de cada línea del original después de una o más NC parciales. El ledger usa decimales enteros escalados, valida las líneas y cantidades de cada nota previa no rechazada, excluye líneas agotadas y rechaza sobregiros. `TOTAL` conserva su semántica anterior y se rechaza después de cualquier NC previa, para no insinuar anulación retroactiva de notas ya emitidas. La NC final usa código de referencia `02` como corrección de monto; la anulación `TOTAL` inicial usa `01`. Los códigos y la elegibilidad jurídica siguen sujetos a DF-06/ADR-BIL-014.

El servicio bloquea la fila original durante la evaluación y creación, por lo que dos correcciones simultáneas serializan el saldo. Ordena las notas previas por fecha e ID para que el snapshot sea estable. El `referenceSnapshot` guarda IDs de notas previas y ledger antes/después de la nueva NC, junto con la referencia fiscal. El documento original permanece inmutable. Se rechaza NC sobre original con ND previa, y ND sobre original con NC previa, mediante `CORRECTION_MIXED_NOTE_POLICY_PENDING`; la política tributaria de efectos cruzados sigue pendiente. La idempotencia v2 existente conserva reserva, replay, conflicto de hash y recuperación, sin cambiar el namespace v1.

`REMAINING` significa el remanente al **asignar el documento**, bajo bloqueo del original. Una reserva interrumpida antes de asignación no fija todavía las cantidades fiscales; si otra corrección se confirma entre reserva y recuperación, el remanente puede cambiar. El hash de idempotencia fija la intención y el origen, no el saldo de la reserva. Esta semántica debe explicitarse/aprobarse en ADR-BIL-014 antes de exponerla fuera del laboratorio; quien necesite una cantidad fija usa `PARTIAL` con cantidades explícitas.

## XSD oficiales fijados

Se obtuvieron bytes estáticos de la CDN oficial `cdn.comprobanteselectronicos.go.cr` para FE, NC y ND v4.4; respuesta HTTP 200 y XML/XSD válido. No hubo envío ni conexión al servicio de recepción de Hacienda. FE coincide con el pin anterior; NC/ND sustituyen las copias de espejo W3-A. Los archivos locales son exactamente los bytes fijados por SHA-256:

| Tipo | URL de origen | Bytes | SHA-256 |
|---|---|---:|---|
| FE | `https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/FacturaElectronica.xsd` | 118624 | `d384afef665573606f6499b2182d6070850ada8c93bc40fa7f0f3901a25b9cc8` |
| NC | `https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/NotaCreditoElectronica.xsd` | 118974 | `a86a86d2f3ad85d050b85b09fd6b8d450beed76f6dcdbe60e0dfe259b3f97ef7` |
| ND | `https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/NotaDebitoElectronica.xsd` | 118992 | `879b782ce33e91bdca3b7d2dc33642b51dc6b45bc8a15a85c0ee22cc594cee4a` |

El [anexo oficial v4.4](https://www.hacienda.go.cr/docs/ANEXOS_Y_ESTRUCTURAS_V4.4.pdf) describe `02` como corrección de monto y enumera códigos de referencia 13–17. El XSD NC descargado conserva una anotación de `02` como corrección de texto y no enumera 13–17 en `CodigoReferenciaType`. La validación XSD sintáctica permite `02`, pero esta discrepancia de metadatos/catálogo y la vigencia de la actualización requieren respuesta del responsable tributario en DF-06. Revalidar la versión y el hash en la fecha de integración. El pin local no equivale a aceptación fiscal oficial.

## Pruebas y reproducción

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

Las pruebas W3-B ejercitan dos NC parciales y `REMAINING`, ledger y snapshot, XML/XSD/XAdES, replay, hash discrepante, sobrecorrección, dos operaciones concurrentes, mezcla NC/ND rechazada, aislamiento de otra empresa/tenant y recuperación de ND tras persistencia. W3-A/W1 cubren controles de emisor, consumidor, asociación, clave y ambiente; W2-B2/W3-A cubren recuperación tras interrupción de la reserva o XML. Los tests de contrato fijan el nuevo modo, scopes y estado inactivo; la suite Inventori comprueba sus 42 pares verbo/ruta v1. Las migraciones se ejecutan solo en PostgreSQL descartable.

| Comando | Resultado del corte |
|---|---|
| Unitarias enfocadas (proyección + pins XSD) | 11/11 PASS. |
| Unidad completa | 1.374 PASS, 13 omisiones preexistentes, 0 fallas. |
| Contratos | 41/41 PASS; 42 pares verbo/ruta v1 fijados. |
| E2E W3 focal, PostgreSQL descartable | 11/11 PASS; 27 migraciones desde base vacía. |
| Build, tipos, seguridad estática | PASS. |
| Lint | 0 errores, 26 advertencias preexistentes. |
| E2E completa con cliente Inventori fijado | 30 suites, 185/185 PASS; 27 migraciones aplicadas desde cero en PostgreSQL descartable. |

La primera E2E completa halló 1 fallo en 183 pruebas: el historial de notas previas carecía de orden estable. Se corrigió la consulta por `createdAt`/`id`, y la E2E W3 focal volvió a pasar 11/11. El fallo inicial no se oculta; la segunda ejecución completa terminó 185/185 tras añadir los casos de otra empresa y recuperación de ND.

En suites E2E históricas aparecen logs de generación PDF asíncrona después del teardown de Jest, aunque esas suites reportan PASS. Se conserva como riesgo de limpieza del entorno de prueba; no se interpreta ese log como validación de entrega PDF de NC/ND.

## Gates y límites

| Gate | Estado provisional |
|---|---|
| `W3_B_CREDIT_NOTE_COMPLETENESS` | `PARTIAL`: cierre de remanente verificado en laboratorio; elegibilidad tributaria y aceptación oficial pendientes. |
| `W3_B_DEBIT_NOTE_COMPLETENESS` | `PARTIAL`: ND acotada W3-A y rechazo explícito de mezcla; política fiscal ND pendiente. |
| `W3_B_ACCUMULATED_CORRECTIONS` | `PASS_LAB_SYNTHETIC` para cadena de NC sobre FE sintética. |
| `W3_B_OFFICIAL_XSD_VALIDATION` | `PARTIAL`: bytes oficiales, hashes y XML firmado validados en laboratorio; discrepancia de catálogo y vigencia pendiente de DF-06. |
| `W3_B_IDEMPOTENCY_RECOVERY` | `PASS_LAB_SYNTHETIC`: reserva/replay/conflicto y recuperación NC/ND; semántica de `REMAINING` antes de asignación documentada para ADR-BIL-014. |
| `W3_B_INVENTORI_COMPATIBILITY` | `PASS_LAB`: 42 pares v1 fijados, 41/41 contratos y E2E completa 185/185 con cliente Inventori. |
| `DBA_TARGET_PREFLIGHT` | `DBA_PREFLIGHT_BLOCKED`: sin conexión autorizada al objetivo; [informe DBA](billing-w3-b-dba-preflight.md). |
| `W3_B_PRODUCTION_READINESS` | `NOT_READY`: DBA, ADR/DF, STAG y autorización productiva pendientes. |

T09/reemplazo de original rechazado y W4 quedan fuera de W3-B. Ningún ADR se declara aprobado.
