# Frente A · NC/ND funcionales en laboratorio

Base `e63dbc4`; rama `codex/billing-nc-nd-functional`. Este corte conserva `W3AFiscalLabModule` fuera de `AppModule`, exige `NODE_ENV=test` y SANDBOX, y no añade DDL, envío a Hacienda ni credenciales v1.

## Alcance verificable

El flujo W2-B2/W3 existente reserva de forma idempotente, bloquea el original, crea una nota por transacción, firma XML con XAdES, valida XSD, guarda XML y transiciones, permite consulta de estado y recupera interrupciones tras reserva o persistencia. Este frente añade comprobación de integridad de la clave y consecutivo del original contra sus campos persistidos y emisor; rechaza una referencia inconsistente antes de asignar la nota. Añade `GET .../corrective-notes/{documentId}/signed-xml` solo al módulo de laboratorio: exige scope de lectura y origen de consumidor/asociación, verifica SHA-256 del XML almacenado y responde 404 cuando el artefacto no existe o 422 si no coincide el hash. El contrato OpenAPI de laboratorio pasa a `0.3.0-lab`; el hash de las solicitudes fiscales y las rutas v1 no cambian.

## Escenarios y decisiones

| Escenario | Estado técnico en laboratorio | Regla propuesta o límite | Decisión fiscal pendiente |
|---|---|---|---|
| NC total inicial, parcial, dos parciales y remanente | Implementados y probados con saldo por línea, decimales exactos, bloqueo del original y XML firmado | `TOTAL` solo sin NC previa; `PARTIAL` no excede la cantidad restante | Confirmar elegibilidad y códigos en ADR-BIL-014/DF-06 |
| ND gravada, exenta, por línea y acumulada | Implementada y probada con ledger de ajustes, idempotencia y XML firmado | Solo tratamiento sintético IVA 13 % o 0 % ya admitido | Política tributaria ND en ADR-BIL-014/DF-06 |
| NC → ND y ND → NC | Rechazo explícito `CORRECTION_MIXED_NOTE_POLICY_PENDING` | No se aplica automáticamente una regla de saldo neto | Aprobar cálculo y secuencias en ADR-BIL-014 |
| Código de referencia 02 | Contrato de laboratorio lo restringe a corrección de monto | El anexo v4.4 describe 02 como corrección de monto; la anotación del XSD NC fijado lo describe como corrección de texto | Resolver discrepancia con responsable fiscal en DF-06 |
| Referencia a documento rechazado | Rechazo explícito; no se trata como NC/ND | La sustitución de comprobantes rechazados es un flujo distinto | ADR-BIL-014/DF-06 |
| Nota sobre original de versión anterior | No habilitada | El anexo permite versiones anteriores para NC/ND de comprobantes emitidos bajo ellas | Selección de XSD/catálogo por fecha en ADR-BIL-016 |
| NC `REMAINING` interrumpida antes de asignación | Recuperable, pero la cantidad deriva del saldo al asignar | Otra nota puede variar el saldo entre reserva y recuperación; `PARTIAL` fija cantidad explícita | Aprobar semántica o exigir saldo esperado en ADR-BIL-014 antes de integración |

El [anexo oficial v4.4](https://www.hacienda.go.cr/docs/ANEXOS_Y_ESTRUCTURAS_V4.4.pdf) exige datos de referencia coherentes y establece que la suma de NC no supere el comprobante más sus ND; no se usa esa frase para habilitar secuencias mixtas sin política aprobada. La [comunicación oficial de actualización](https://www.hacienda.go.cr/docs/ActualizacionAnexosyEstructurasVersion4.4CEv2.pdf) anuncia nuevos códigos y su fecha de implementación. Validar el catálogo y XSD efectivos en la fecha de integración sigue siendo DF-06. La validación XSD de los bytes oficiales fijados en `resources/hacienda/v4.4` acredita estructura, no aceptación tributaria.

## Reproducción

```powershell
npx prisma generate
npm run typecheck
npm run build
npm run lint:check
npm run test:safety:static
npm run test:w1:d0 -- --silent
npm test -- --runInBand --silent
npm run test:e2e:disposable -- w3-a-corrective-lab
$env:INVENTORI_BILLING_CLIENT_PATH='C:\Users\kmena\Documents\proyectos\inventory-api\inventory-api\src\services\billing-api-client.service.js'
npm run test:e2e:disposable
```

El script `test:e2e:disposable` crea PostgreSQL efímero, aplica las 27 migraciones desde cero y lo destruye al terminar. El cliente Inventori se lee para la prueba de compatibilidad; no se modifica.

## Evidencia de este corte

| Validación | Resultado |
|---|---|
| E2E W3 focal | 14/14 PASS: XML firmado leído por HTTP, hash alterado rechazado, aislamiento, referencia inconsistente rechazada, NC/ND, concurrencia y recuperación |
| Contratos | 42/42 PASS; 42 pares verbo/ruta v1 Inventori protegidos |
| Unidad completa | 1.375 PASS, 13 omisiones preexistentes, 0 fallas |
| Tipos, build, seguridad estática | PASS |
| Lint | PASS con 26 advertencias preexistentes, 0 errores |
| Migraciones efímeras | 27/27 aplicadas desde base vacía |
| E2E completa con cliente Inventori leído del repositorio local | 30 suites, 190/190 PASS; 27 migraciones efímeras |

La revisión de DBA de la base objetivo, STAG, aceptación por Hacienda, aprobación ADR-BIL-014/016 y DF-06, y autorización productiva siguen pendientes. No se declara listo para producción.

## Riesgos residuales y gates

La comprobación nueva reconstruye la clave con el generador existente; antes de integración debe verificarse que el huso horario de emisión se conserve entre procesos. El laboratorio usa originales emitidos en la misma configuración. La antigüedad máxima de diez años indicada en el anexo necesita un caso de referencia histórica y una política de versión por fecha; no se declara validada para versiones anteriores. Los eventos de auditoría se escriben transaccionalmente, pero la base objetivo no se ha verificado para una prohibición física de `UPDATE`/`DELETE` sobre el historial.

| Gate | Estado |
|---|---|
| `NC_FUNCTIONAL_LAB` | `PASS_LAB_SYNTHETIC` para total, parcial, remanente y sucesivas en el subconjunto admitido |
| `ND_FUNCTIONAL_LAB` | `PASS_LAB_SYNTHETIC` para ajustes gravados/exentos por línea y acumulados del subconjunto admitido |
| `NC_ND_MIXED_SEQUENCES` | `BLOCKED_PENDING_FISCAL_APPROVAL`; ambos órdenes rechazan 422 |
| `OFFICIAL_XSD_VALIDATION` | `PASS_PINNED_LAB`; vigencia y discrepancia de catálogo pendientes de DF-06 |
| `FISCAL_DECISIONS` | `PENDING`: ADR-BIL-014/016 y DF-06 sin aprobación formal |
| `INVENTORI_COMPATIBILITY` | `PASS_LAB`: 42 pares v1, 42 contratos y 190 E2E |
| `PRODUCTION_READINESS` | `NOT_READY` |
