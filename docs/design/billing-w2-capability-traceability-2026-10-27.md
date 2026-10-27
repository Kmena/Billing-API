# Billing — trazabilidad C01–C54 al cierre W1 / diseño W2

**Corte auditado:** 2026-10-27, base `ab65429`. Esta vista conserva exactamente los estados auditados del [SDD maestro](../../billing-completion-sdd.md) §4; no los eleva a PASS. W1 y W2 remiten a la [evidencia W1](../operations/billing-w1-lab-integration-2026-10-27.md) y la [especificación W2](billing-w2-executable-spec-proposed-2026-10-27.md). La implementación estructural W2-A no acredita emisión fiscal.

| Capacidad | Estado auditado | Evidencia/gate | Wave | Trazabilidad al cierre |
|---|---|---|---|---|
| C01 | COMPLETE_VERIFIED | V: aislamiento tenant/empresa en regresión | W0 | Fuera de W1/W2; mantener gate del SDD. |
| C02 | COMPLETE_VERIFIED | V: perfil fiscal v1 intacto | W0 | Fuera de W1/W2; mantener gate del SDD. |
| C03 | IMPLEMENTED_UNVERIFIED | I: asociación plural y consumerId probado | W1 | W1; mantener gate del SDD. |
| C04 | COMPLETE_VERIFIED | V: consulta fiscal y fallos externos reproducibles | W0 | Fuera de W1/W2; mantener gate del SDD. |
| C05 | COMPLETE_VERIFIED | V: actividad por emisor y ambiente | W0 | Fuera de W1/W2; mantener gate del SDD. |
| C06 | IMPLEMENTED_UNVERIFIED | V: ciclo M2M de sucursal/terminal y secuencia | W0 | Fuera de W1/W2; mantener gate del SDD. |
| C07 | COMPLETE_VERIFIED | V: concurrencia y procedencia de migración | W0 | Fuera de W1/W2; mantener gate del SDD. |
| C08 | COMPLETE_VERIFIED | V: readiness revalidado antes de asignar clave | W1 | W1; mantener gate del SDD. |
| C09 | COMPLETE_VERIFIED | V: credenciales por emisor/ambiente sin exposición | W0 | Fuera de W1/W2; mantener gate del SDD. |
| C10 | COMPLETE_VERIFIED | V: certificado, identidad, rotación y custodia | W0 | Fuera de W1/W2; mantener gate del SDD. |
| C11 | PARTIAL | P: matriz negativa tenant/empresa/ambiente/consumerId | W1 | W1; mantener gate del SDD. |
| C12 | IMPLEMENTED_UNVERIFIED | P: alta, rotación y revocación de perfil afiliaciones | W1 | W1; mantener gate del SDD. |
| C13 | COMPLETE_VERIFIED | V: FE gravada sin regresión v1 | W2 | W2; mantener gate del SDD. |
| C14 | IMPLEMENTED_UNVERIFIED | V: TE aceptado en STAG si aplica | W6 | Fuera de W1/W2; mantener gate del SDD. |
| C15 | MISSING | I: NC total referenciada y aceptada | W3 | Fuera de W1/W2; mantener gate del SDD. |
| C16 | MISSING | I: NC parcial con límite acumulado | W3 | Fuera de W1/W2; mantener gate del SDD. |
| C17 | MISSING | I: ND referenciada y aceptada | W3 | Fuera de W1/W2; mantener gate del SDD. |
| C18 | MISSING | D/I: decisión de aplicabilidad y FEC si corresponde | W4 | Fuera de W1/W2; mantener gate del SDD. |
| C19 | MISSING | D/I: decisión exportación y FEE si corresponde | W4 | Fuera de W1/W2; mantener gate del SDD. |
| C20 | MISSING | D/I: dictamen REP y contrato si corresponde | W4 | Fuera de W1/W2; mantener gate del SDD. |
| C21 | MISSING | D/I: rol receptor y mensajes si corresponde | W4 | Fuera de W1/W2; mantener gate del SDD. |
| C22 | COMPLETE_VERIFIED | V: IVA gravado y resumen regresión | W2 | W2; mantener gate del SDD. |
| C23 | PARTIAL | P/D: exento técnicamente válido y fundamento por emisor | W2 | W2; mantener gate del SDD. |
| C24 | MISSING | I/D: no sujeto/0 % si caso real y regla aprobada | W2 | W2; mantener gate del SDD. |
| C25 | MISSING | I/D: exoneración con soporte y sumas si aplica | W2 | W2; mantener gate del SDD. |
| C26 | PARTIAL | P/D: impuestos múltiples requeridos por emisores | W2 | W2; mantener gate del SDD. |
| C27 | PARTIAL | P/D: CABYS vigente y aptitud por concepto | W2 | W2; mantener gate del SDD. |
| C28 | IMPLEMENTED_UNVERIFIED | V: XSD/importe/descuento en ambiente apto | W0 | Fuera de W1/W2; mantener gate del SDD. |
| C29 | MISSING | D/I: política de precio incluido o normalización externa | W2 | W2; mantener gate del SDD. |
| C30 | PARTIAL | P: matriz exacta de redondeo y conciliación | W2 | W2; mantener gate del SDD. |
| C31 | PARTIAL | P/D: tasa congelada y monedas del alcance | W2 | W2; mantener gate del SDD. |
| C32 | MISSING | D/I: contrato extranjero y exportación si procede | W4 | Fuera de W1/W2; mantener gate del SDD. |
| C33 | IMPLEMENTED_UNVERIFIED | P/V: XSD oficial vigente, hash y pipeline completo | W0/W2 | W2; mantener gate del SDD. |
| C34 | COMPLETE_VERIFIED | V: firma por tipo/certificado en regresión | W2 | W2; mantener gate del SDD. |
| C35 | COMPLETE_VERIFIED | V: evidencia STAG por tipo; no inferir de FE | W6 | Fuera de W1/W2; mantener gate del SDD. |
| C36 | IMPLEMENTED_UNVERIFIED | V: GET/callback real y reconciliación | W5/W6 | Fuera de W1/W2; mantener gate del SDD. |
| C37 | PARTIAL | P: reemplazo rechazado sin NC ni doble cobro | W3 | Fuera de W1/W2; mantener gate del SDD. |
| C38 | COMPLETE_VERIFIED | V/P: v1 intacto y namespace v2 tras rotación | W1 | W1; mantener gate del SDD. |
| C39 | PARTIAL | P: recuperación duradera tras caída y POST ambiguo | W5 | Fuera de W1/W2; mantener gate del SDD. |
| C40 | IMPLEMENTED_UNVERIFIED | V: XML/respuesta y hashes restaurados | W5 | Fuera de W1/W2; mantener gate del SDD. |
| C41 | IMPLEMENTED_UNVERIFIED | V: PDF local verificable y cobertura por tipo | W0/W5 | Fuera de W1/W2; mantener gate del SDD. |
| C42 | IMPLEMENTED_UNVERIFIED | V: entrega, rebote y reenvío real | W5 | Fuera de W1/W2; mantener gate del SDD. |
| C43 | MISSING | I: feed durable y webhook firmado opcional | W5 | Fuera de W1/W2; mantener gate del SDD. |
| C44 | PARTIAL | P: auditoría, retención y atribución por consumidor | W5 | Fuera de W1/W2; mantener gate del SDD. |
| C45 | PARTIAL | P: OpenAPI/fixtures versionados por operación | W1–W5 | W1; mantener gate del SDD. |
| C46 | PARTIAL | V/P: suite reproducible, fallas clasificadas | W0 | Fuera de W1/W2; mantener gate del SDD. |
| C47 | IMPLEMENTED_UNVERIFIED | V: E2E DB descartable en CI/host apto | W0 | Fuera de W1/W2; mantener gate del SDD. |
| C48 | IMPLEMENTED_UNVERIFIED | V: evidencia FE STAG reproducible/conservada | W6 | Fuera de W1/W2; mantener gate del SDD. |
| C49 | BLOCKED | D/V: aceptación por cada tipo y escenario aplicable | W6 | Fuera de W1/W2; mantener gate del SDD. |
| C50 | BLOCKED | D: autorización productiva por artefacto/emisor | W7 | Fuera de W1/W2; mantener gate del SDD. |
| C51 | PARTIAL | P: restore DB/artefactos/secretos y RPO/RTO | W5 | Fuera de W1/W2; mantener gate del SDD. |
| C52 | PARTIAL | P: métricas, alertas y runbooks operados | W5 | Fuera de W1/W2; mantener gate del SDD. |
| C53 | PARTIAL | P/V: CI y migraciones reconciliadas por checksum | W0/W7 | Fuera de W1/W2; mantener gate del SDD. |
| C54 | NOT_APPLICABLE | N/A: ledger comercial permanece en consumidor | — | Fuera de W1/W2; mantener gate del SDD. |

**Control de cobertura:** 54 identificadores únicos C01–C54, copiados del SDD sin reclasificar. C54 conserva `NOT_APPLICABLE`: el ledger comercial queda en el consumidor. Para W1, C03/C08/C11/C12/C38/C45 exigen activación y evidencias operativas separadas. Para W2, C13/C22–C31/C33/C34 exigen contrato y decisiones fiscales por escenario; el estado previo no acredita emisión v2.

## Evidencia W2-A estructural, sin reclasificar capacidades

La [evidencia técnica W2-A](../operations/billing-w2-a-structural-technical-evidence.md) registra comandos, resultados y el límite del hash candidato.

| Capacidades | Evidencia nueva | Límite del gate |
|---|---|---|
| C13, C22, C23, C24, C25, C26, C27 | DTO de 1–1.000 líneas, impuestos declarados y referencias; múltiples conceptos/períodos. | Ningún código, tratamiento, CABYS, tarifa o exoneración aprobado; FE v2 no se emite. |
| C28, C29, C30, C31 | Decimal exacto de transporte, descuentos sucesivos acotados, totales estructurales y tasa opcional; `INCLUSIVE` rechazado. | Sin redondeo fiscal, suma tributaria, conciliación de pagos ni regla de divisa aprobados. |
| C33, C34 | V1 XSD/XAdES queda como regresión. | No hay serializador, firma ni XSD v2; ADR-BIL-016/DF-06 pendientes. |
| C45 | OpenAPI propuesto alineado con DTO y vector de hash `w2-a-structural.v1`. | Hash de comparación sintética; no es `fiscal-payload.v2` ni reserva fiscal. |
| C54 | `source` es procedencia comercial opaca; campos de ledger y autoridad de consumidor en body se rechazan. | Billing no calcula deuda ni asigna pagos. |

Todas las capacidades, incluidas las no citadas en esta sección, conservan exactamente su estado y gate auditado en la tabla anterior. `W1_TARGET_DB_READINESS`, STAG y producción siguen `NOT_READY`; no se infiere aprobación de ADR-BIL-011/012/013, DP-01/02 ni DF.
