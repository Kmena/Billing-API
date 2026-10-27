# Auditoría de capacidades de Billing

**Corte:** 27 de octubre de 2026, rama `7-conexion_m2m`, HEAD `9983368`. Se inspeccionó el árbol de trabajo, incluidos cambios locales preexistentes en documentos fiscales; este informe no representa un artefacto desplegado. No se leyó ningún secreto, se aplicó ninguna migración ni se llamó a Hacienda. Los informes históricos se usan como evidencia contextual y se contrastan con código actual.

## Criterio y resultado

`COMPLETE_VERIFIED` exige ruta funcional, persistencia/contrato cuando corresponde y prueba pertinente observada en el repositorio o ejecutada en este corte. La verificación **local** no implica aceptación en STAG ni autorización de producción. `IMPLEMENTED_UNVERIFIED` tiene implementación pero falta evidencia suficiente del comportamiento completo; `PARTIAL` cubre una parte del caso; `MISSING` no tiene implementación; `BLOCKED` requiere una decisión, dato o autorización externa; `NOT_APPLICABLE` queda fuera del servicio con justificación. La columna de impacto usa **A** para afiliaciones, **I** para Inventori y **B** para ambos.

La matriz contiene **54 capacidades** con **13 `COMPLETE_VERIFIED` (24,1 %)**. Este cociente es cobertura de capacidades auditadas con evidencia suficiente en el alcance indicado, **no porcentaje de avance del desarrollo**. Incluye una capacidad `NOT_APPLICABLE` en el denominador explícito; excluyéndola serían 13/53 = 24,5 %. No se promedian estados ni se atribuye equivalencia entre pruebas unitarias, STAG y producción.

## Fuentes normativas y límites

- El [Reglamento de Comprobantes Electrónicos, Decreto 44739-H](https://www.hacienda.go.cr/docs/REGLAMENTO_DE_COMPROBANTES_ELECTRONICOS.pdf), artículos 9–10, enumera documentos y exige notas para modificar comprobantes válidos; un comprobante rechazado carece de validez y no se corrige con nota. Sus artículos 4, 13 y 23 tratan entrega, conservación, consecutivos y contingencia.
- Los [Anexos y Estructuras v4.4](https://www.hacienda.go.cr/docs/ANEXOS_Y_ESTRUCTURAS_V4.4.pdf) definen campos, catálogos y XSD por tipo. La [comunicación oficial de actualización v4.4](https://www.hacienda.go.cr/docs/ActualizacionAnexosyEstructurasVersion4.4CEv2.pdf) añade códigos de referencia 13–17 y 19–20 y señala obligatoriedad a partir del **1 de noviembre de 2026**. Debe obtenerse el paquete vigente y compararse con los dos XSD fijados localmente antes de liberar.
- La [API de recepción oficial](https://www.hacienda.go.cr/docs/ComprobantesElectronicosAPI.html) distingue recepción HTTP de validación fiscal definitiva y documenta OIDC, POST, GET y callback. Los criterios de IVA/exención aplicables a una entidad concreta y el momento del hecho generador requieren decisión tributaria documentada; una tarifa de referencia CABYS no prueba exención.

## Matriz

| ID | Capacidad | Estado | Evidencia actual y límite | Impacto / dependencia |
|---|---|---|---|---|
| C01 | Tenants y empresas | COMPLETE_VERIFIED | `prisma/schema.prisma` (`Tenant`, `Company`); `company.controller.ts`; E2E `company-fiscal-profile.e2e-spec.ts` | B |
| C02 | Perfil fiscal del emisor | COMPLETE_VERIFIED | `CompanyFiscalProfile`, `company.controller.ts`, onboarding v1 y E2E de perfil | B |
| C03 | Asociación de emisor externo | IMPLEMENTED_UNVERIFIED | `FiscalIntegrationAssociation`, `fiscal-onboarding-v1.controller.ts`; perfil centrado en Inventori, falta contrato neutral probado para segundo consumidor | A / perfil nuevo |
| C04 | Consulta/validación de contribuyente | COMPLETE_VERIFIED | `taxpayer-verification.controller.ts`, handlers y pruebas; disponibilidad externa no garantizada | B |
| C05 | Actividades económicas habilitadas | COMPLETE_VERIFIED | modelos, handlers, controlador y pruebas de actividad | B |
| C06 | Sucursales y terminales configurables | IMPLEMENTED_UNVERIFIED | `FiscalBranch`, `FiscalTerminal`, `FiscalIssuancePoint`; onboarding v1 ofrece altas, consultas y cambios M2M, sin verificación externa del ciclo completo | B |
| C07 | Consecutivos por empresa/ambiente/tipo/punto | COMPLETE_VERIFIED | `FiscalSequence`, índice único; `fiscal-management.controller.ts`, E2E concurrencia | B / reconciliar migraciones |
| C08 | Elegibilidad fiscal consultable | COMPLETE_VERIFIED | `.../:environment/readiness` y onboarding v1; pruebas `fiscal-readiness-consistency.e2e-spec.ts` | B / configuración real |
| C09 | Credenciales Hacienda por empresa/ambiente | COMPLETE_VERIFIED | `HaciendaConnection`, `hacienda-credentials-m2m.controller.ts`, E2E conexión | B / proveedor de secretos |
| C10 | Certificado PKCS#12, identidad y rotación | COMPLETE_VERIFIED | `fiscal-certificate.controller.ts`, pruebas de seguridad/identidad y migración de índice activo | B / custodia operativa |
| C11 | Aislamiento tenant/empresa y scopes M2M | PARTIAL | guard, `ApiKeyCompany`, pruebas cruzadas; rutas dispares y falta validación E2E del nuevo consumidor, ambientes y claves separadas | B / prueba cruzada |
| C12 | Ciclo de vida de claves M2M | IMPLEMENTED_UNVERIFIED | `api-keys.controller.ts` crea, lista, revoca y asocia; perfiles actuales `inventori-*`, sin autoservicio neutral del nuevo sistema | A / diseño de permisos |
| C13 | FE básica gravada | COMPLETE_VERIFIED | `fiscal-documents.controller.ts`, servicio, serializador, XSD y E2E; registro histórico de FE aceptada en STAG | B / nuevo despliegue |
| C14 | TE básico | IMPLEMENTED_UNVERIFIED | ruta, serializador FE/TE y pruebas locales; no hallé aceptación TE real en STAG | B / STAG TE |
| C15 | Nota de crédito total | MISSING | `FiscalDocumentType` solo `INVOICE`,`TICKET`; sin ruta ni XSD NC | B / referencia al origen |
| C16 | Nota de crédito parcial | MISSING | sin importes acumulados, saldo corregible, referencia ni pruebas | B / C15 |
| C17 | Nota de débito | MISSING | sin tipo, ruta, XSD ni firma de ND | B / referencia al origen |
| C18 | Factura electrónica de compra | MISSING | sin tipo FEC ni contrato; aplicabilidad depende de compras del emisor | B / decisión de producto |
| C19 | Factura de exportación | MISSING | sin tipo FEE; relevante si se factura servicio exportado | B / supuesto tributario |
| C20 | Recibo electrónico de pago | MISSING | sin tipo REP; se requiere solo en supuestos normativos de crédito/pago diferido | A / análisis tributario |
| C21 | Mensajes de confirmación de receptor | MISSING | no hay recepción/confirmación de facturas de compra como producto | B / rol de receptor |
| C22 | IVA gravado y subtotales | COMPLETE_VERIFIED | `validateCreateCommand`, `computeSummary`, pruebas XML FE/TE; cobertura limitada a tratamientos admitidos | B |
| C23 | Cuota exenta, IVA 01/tarifa 10 | PARTIAL | corrección local en servicio/serializador y pruebas XSD; no STAG exento, decisión legal y CABYS por concepto pendientes | B / criterio fiscal |
| C24 | No sujeción y 0 % con crédito | MISSING | código rechaza `FISCAL_ZERO_TAX_TREATMENT_UNSUPPORTED` salvo redondeo 13 % | B / contrato fiscal |
| C25 | Exoneración total/parcial | MISSING | DTO sin `Exoneracion`; serializador sin totales exonerados | B / documentos de soporte |
| C26 | Varios impuestos por línea y tarifas especiales | PARTIAL | DTO admite un `taxCode/taxRateCode/taxAmount`; agrupa líneas, no arreglo de impuestos | B / alcance tributario |
| C27 | CABYS de línea y consulta | PARTIAL | valida formato de 13 dígitos, API catálogo; no demuestra pertenencia/aptitud fiscal en toda emisión | B / catálogo vigente |
| C28 | Descuentos de línea | IMPLEMENTED_UNVERIFIED | validación de código/naturaleza/importe; pruebas XSD dependientes del subproceso Python fallaron por `EPERM` local | B |
| C29 | Precio con impuesto incluido | MISSING | entrada solo `unitPrice` + impuesto explícito; sin convención contractual de descomposición | A / contrato productor |
| C30 | Redondeo y conciliación decimal | PARTIAL | `ScaledDecimal` a 5 decimales; faltan matrices E2E de múltiples pagos/monedas/correcciones | B |
| C31 | CRC/USD y tipo de cambio | PARTIAL | DTO limita a CRC/USD; `exchangeRate` y servicio de consulta; sin política de tasa congelada para todas las monedas/casos | B |
| C32 | Receptor extranjero | MISSING | `validateReceiver` exige identificación numérica de 1–12 y correo en FE; sin contrato extranjero verificado | A / FEE según caso |
| C33 | XML v4.4 FE/TE y XSD local | IMPLEMENTED_UNVERIFIED | dos XSD en `resources/hacienda/v4.4`, serializador; `python` directo compila FE pero adaptador Node→Python falló por `EPERM` en este entorno; falta actualización oficial 2026 | B / actualización normativa |
| C34 | Firma XAdES-EPES | COMPLETE_VERIFIED | adaptador de firma y pruebas; FE histórica STAG firmada | B / certificado por emisor |
| C35 | Envío OIDC/POST a Hacienda | COMPLETE_VERIFIED | adaptadores, worker y evidencia histórica STAG FE aceptada en `specs/fase-4-s...`; solo STAG FE | B / habilitación producción |
| C36 | Consulta/callback de respuesta | IMPLEMENTED_UNVERIFIED | GET, `hacienda-callback.controller.ts`, parser y pruebas; callback real no acreditado | B |
| C37 | Rechazo y sustitución de comprobante inválido | PARTIAL | estados `REJECTED`,`SUPERSEDED` y recuperación; falta contrato de reemplazo y matriz fiscal integral | B / sin nota para rechazo |
| C38 | Idempotencia de creación | COMPLETE_VERIFIED | `FiscalIdempotencyKey`, hash fiscal, lookup v1/v2, pruebas de concurrencia y migración de reconciliación | B / migración objetivo |
| C39 | Reintentos, ambigüedad de POST, reinicio | PARTIAL | estados, `POST_OUTCOME_UNKNOWN`, workers y E2E; recuperación histórica está condicionada por despliegue/configuración | B / ensayo operativo |
| C40 | XML firmado y respuesta oficial recuperables | IMPLEMENTED_UNVERIFIED | `FiscalArtifact`, rutas de descarga y almacenamiento; falta ensayo de retención/restauración en destino productivo | B |
| C41 | PDF gráfico desde XML | IMPLEMENTED_UNVERIFIED | renderer y `test/wave0..7`; no se acredita conformidad visual/fiscal para todos los documentos futuros | B |
| C42 | Correo inicial, respuesta y reenvío | IMPLEMENTED_UNVERIFIED | `DocumentDelivery`, worker, SMTP, accepted-package-resend y E2E mock; falta SMTP real/recepción/rebote en destino | B |
| C43 | Webhook hacia consumidores externos | MISSING | callback existente es **Hacienda → Billing**; sin eventos Billing → Inventori/afiliaciones | A / outbox y firmas |
| C44 | Trazabilidad de eventos y auditoría fiscal | PARTIAL | `AuditLog`/`EventClass`, interceptores; no demuestra retención, inmutabilidad operativa y reconciliación exhaustiva | B |
| C45 | OpenAPI completo de emisión/onboarding | PARTIAL | Swagger generado y YAML de onboarding/lookup/equivalencia; falta contrato versionado completo de ciclo fiscal y errores | A |
| C46 | Pruebas unitarias fiscales | PARTIAL | 106 suites/1.264 pruebas pasaron; 7 suites/43 pruebas fallaron en este entorno, principalmente por subproceso Python y escritura de PDF | B / ejecutar en entorno apto |
| C47 | E2E aislado con PostgreSQL | IMPLEMENTED_UNVERIFIED | suite y CI `test:e2e:disposable`; no se ejecutó completo en este corte | B / infraestructura descartable |
| C48 | Aceptación STAG FE gravada | IMPLEMENTED_UNVERIFIED | informe histórico con clave y resultado `ACCEPTED`; artefactos sanitizados ignorados no están versionados ni se repitió hoy | B / evidencia conservada |
| C49 | Aceptación STAG TE/exento/NC/REP | BLOCKED | TE/exento no demostrado; NC/REP ni existen; exige credenciales y escenarios autorizados | B / C15,C20,C23 |
| C50 | Autorización fiscal/operativa producción | BLOCKED | `wave2-security-release-candidate.md` declara `PRODUCTION_AUTHORIZATION=BLOCKED`; aprobación y despliegue verificables faltan | B / gates humanos |
| C51 | Backups/restauración de DB, XML y secretos | PARTIAL | scripts, procedimientos y restauraciones locales; no hay RPO/RTO ni ensayo del objetivo productivo | B / custodia y simulacro |
| C52 | Logs, métricas y alertas | PARTIAL | logs, correlation ID y health; sin evidencia de métricas/alertas y tablero de colas/errores fiscales | B / observabilidad |
| C53 | CI, seguridad y migraciones reproducibles | PARTIAL | `.github/workflows/ci.yml`, pruebas; historial de migración objetivo divergente según operaciones y cambios locales sin congelar | B / reconciliación |
| C54 | Obligaciones, pagos y saldos comerciales | NOT_APPLICABLE | No hay modelos Billing de afiliación/período/cobro; pertenecen al sistema de afiliaciones por ADR-010 | A / contrato fiscal de entrada |

## Hallazgos transversales

1. El modelo `FiscalDocumentType` limita cualquier documento correctivo y REP desde la base de datos hasta API, XML, almacenamiento y entrega. No basta añadir una ruta.
2. El XML exento local ya conserva tarifa 10, pero la justificación jurídica de **cada** cuota, el CABYS específico y la aceptación externa no están demostrados. `taxAmount=0` no permite inferir exención.
3. Las referencias oficiales nuevas de v4.4 y el supuesto de REP deben entrar al diseño de notas/pagos; los XSD locales cubren solamente FE/TE. Un rechazo de Hacienda exige reemisión conforme a causa, no nota de crédito.
4. El M2M existente está diseñado principalmente alrededor de perfiles `inventori-*`. Para dos aplicaciones independientes deben existir identidad, permisos, claves, idempotencia y trazabilidad por consumidor y por empresa.
5. El informe de seguridad de octubre identifica una discrepancia de procedencia de migraciones entre fuente y base observada. Ninguna conclusión de producción puede depender de aplicar automáticamente los archivos `202611*`, fechados después del corte.

## Revisión de ADR y SPEC

`specs/fase-0-foundation/decisions.md` (ADR-002/003/006/008/009/010) define aislamiento por tenant, cola pg-boss, secretos, API keys, retención y separación de Inventori. El código contiene esos mecanismos, pero el ADR no prueba su configuración productiva. `specs/fase-2-2-fiscal-document-core/requirements.md` excluyó expresamente notas de crédito/débito, documentos recibidos y pagos de esa fase; esa exclusión histórica confirma que no deben declararse completas hoy. `specs/billing-tax-exempt-xml/README.md` documenta el defecto previo y la corrección local de `01/10`; la decisión de exención para una Cámara no se generaliza a otro emisor. `specs/fase-4-fiscal-artifacts-delivery/accepted-fiscal-package-resend-m2m-addendum.md` se rotula "proposed", pero el controlador y servicio de reenvío ya están en el árbol actual: manda el código y sus pruebas, no el estado antiguo del SPEC. `docs/contracts/fiscal-onboarding.v1.*` define un perfil y operaciones M2M de Inventori; no existe contrato equivalente específico de afiliaciones. No encontré un SPEC dedicado a NC/ND ya implementadas.

## Verificación de este corte

`npx tsc --noEmit --incremental false`: **PASS**. `npm run typecheck` no pudo escribir `dist/tsconfig.tsbuildinfo` (`EPERM`); es una limitación de escritura local, no un error de tipos. `npm test -- --runInBand --silent`: **106 suites aprobadas, 7 fallidas, 3 omitidas; 1.264 pruebas aprobadas, 43 fallidas, 13 omitidas**. `node` no pudo lanzar `python` (`spawnSync python EPERM`), mientras `python .../xmlschema-validator.py compile .../FacturaElectronica.xsd` directamente devolvió `valid:true`; seis suites fallidas dependen del adaptador XSD y ese fallo de entorno no demuestra XML inválido. La séptima suite falló en 8 pruebas de PDF por `EPERM` al escribir en `test-output/pdf`; 29 pruebas de esa suite pasaron. No se ejecutaron E2E ni STAG por requerir infraestructura/credenciales y poder consumir consecutivos.
