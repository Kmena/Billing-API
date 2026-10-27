# Roadmap de terminación de Billing

Este plan ordena cambios futuros; **no inicia implementación**. Complejidad relativa: S (días de ingeniería concentrada), M (varias iteraciones), L (varios componentes y contratos), XL (ciclo fiscal/regulatorio nuevo). No es un compromiso de calendario. Ninguna wave autoriza transmisión real ni despliegue.

| Wave | Entrega y dependencias | Criterios de aceptación | Pruebas y complejidad |
|---|---|---|---|
| 0. Decisión fiscal y base verificable | Dictamen por emisor y concepto: cuotas exentas/gravadas, CABYS, momento de FE, anticipos, pago parcial, REP, cliente extranjero/exportación; inventario de códigos de referencia 2026; congelar fuente/migraciones/imagen y resolver fallas actuales de suite. Depende de dueño fiscal, producto y DBA | Tabla versionada de reglas con ejemplos de 16 escenarios; XSD/catálogos oficiales con hashes; migraciones aplicadas y pendientes reconciliadas; CI verde reproducible | Revisión fiscal externa, tests de fixtures, `prisma migrate status` **solo lectura** y ensayo descartable; M |
| 1. Contrato M2M e integridad de afiliaciones | Perfil `affiliations-fiscal-v1`, scopes por empresa/ambiente, FiscalIntent y hash de payload v2, campos externos inmutables, OpenAPI y polling de estados. Depende de wave 0 | Ninguna clave de Inventori funciona en empresa nueva; reintento idéntico devuelve misma identidad; cambio de período/impuesto/monto rechaza conflicto; líneas reflejan asignaciones y totales | Contract tests de ambos consumidores, E2E DB descartable, aislamiento cruzado, concurrencia y reinicio; L |
| 2. FE/TE y tributación requerida | Cerrar exento `01/10` con regla aplicable; tratamientos no sujeto, 0 % y exoneración **solo según emisores reales**; precios incluidos, redondeo, tasa congelada, receptor extranjero según decisión; actualizar XSD/códigos y PDF. Depende de waves 0–1 | FE gravada/exenta y TE aplicable pasan XSD vigente, firma, conservación y STAG autorizado; resumen y línea coinciden; cero sin metadatos se rechaza; no se confunden exención/no sujeción/exoneración | Matriz de impuesto×descuento×moneda×receptor×FE/TE, pruebas de límites y STAG por tipo; XL |
| 3. Correcciones y pagos fiscales | NC total/parcial, ND, referencias, saldo correctivo y prohibición de sobrerreverso; REP solo si dictamen lo requiere; reemplazo de rechazados. Depende de waves 0–2 | Original aceptado inmutable; nota enlazada, firma/XML/PDF/entrega; crédito acumulado ≤ base corregible; rechazo no genera nota; varias NC concurrentes seguras | Unidad de aritmética, transacciones/concurrencia, E2E DB, STAG por tipo y recuperación ante timeout; XL |
| 4. Continuidad, entrega y salida de eventos | Outbox/webhooks o polling garantizado, replay, SMTP y rebotes, backups DB/artefactos/secretos, métricas/alertas, runbooks, retención y seguridad. Depende de waves 1–3 | Eventos verificables y deduplicables; caída/reinicio sin doble clave/entrega perdida; restore íntegro con RPO/RTO acordados; alertas sobre pendientes y rechazo | Partición de red, cola detenida, SMTP incierto, restore aislado, revisión de secretos y pentest dirigido; L |
| 5. Gate de producción | Candidato inmutable, migraciones ensayadas, evidencia STAG representativa, capacitación/operación y aprobaciones del emisor/seguridad/DB/fiscal. Depende de 0–4 según alcance de lanzamiento | Checklist `billing-production-readiness.md` íntegro y firmado; sin divergencia de código/imagen/DB/XSD; pruebas de reverso y recuperación; activación por empresa | Smoke sin tráfico fiscal, canary autorizado, reconciliación de documentos/colas, respaldo y rollback ensayados; M más ventana operativa |

## Orden de implementación recomendado

1. Cerrar wave 0 antes de modelar correcciones o anticipos. La actualización oficial de referencias con fecha 1 de noviembre de 2026 afecta precisamente documentos correctivos y REP.
2. Construir contrato M2M y ledger de FiscalIntent del consumidor antes de ampliar emisión. Esto permite probar que una sola aplicación de pago no produce dos claves y que cada línea conserva su período.
3. Completar FE exenta/gravada y escenarios de cobro más frecuentes; luego el núcleo compartido de NC/ND. No diseñar reversión comercial como borrado fiscal.
4. Evaluar REP, FEE, FEC y confirmaciones contra el régimen de cada emisor. El reglamento los reconoce; no son automáticamente requeridos para toda afiliación.
5. Cerrar el gate operativo con fuente vigente, migraciones y artefactos productivos exactos. Un PASS local o una FE STAG histórica no sustituye el gate.

## Dependencias y criterios de salida por escenario

| Escenario de negocio | Wave mínima | Gate adicional |
|---|---|---|
| Cuota gravada al contado, un período | 0–2 | FE/STAG del emisor y entrega |
| Cuota exenta | 0–2 | fundamento de exención por entidad/concepto + CABYS + STAG exento |
| Varias cuotas/afiliaciones en un pago | 0–2 | líneas y sumas por asignación; decisión una/múltiples FE |
| Pago parcial de crédito | 0–3 si REP aplica | dictamen de hecho generador y REP; saldo comercial en consumidor |
| Anticipo/excedente | 0–3 según regla | no facturar servicio no devengado por inferencia técnica |
| Cancelación/reversión/corrección | 0–3 | NC/ND y límites acumulados; prueba de rechazo diferente |
| Cliente extranjero/moneda distinta | 0–2/3 | identidad, FEE si exportación, tasa y aceptación externa |

## Evidencia que debe acompañar cada wave

PR y diff de código; OpenAPI/fixtures versionados; matriz de requisitos; resultado reproducible de lint, tipos, unidad y E2E con commit/hash; datos de prueba sintéticos; hash de XSD; artefactos STAG sanitizados con clave y respuesta oficial por tipo cuando se autorice; plan de migración/rollback y revisión fiscal. Una prueba omitida se registra como `NOT_RUN`, nunca como PASS.
