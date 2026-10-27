# Brechas priorizadas de Billing para afiliaciones

**Base:** [matriz de 54 capacidades](billing-capability-audit.md). P0 significa bloqueo para el alcance operativo planteado, no que toda entidad deba emitir todos los tipos. Antes de configurar impuestos se debe resolver por escrito el régimen del emisor y el hecho generador por concepto, período y forma de cobro. Para un lanzamiento deliberadamente limitado a FE al contado y sin correcciones reales, algunos P0 podrían diferirse solo si se excluyen contractualmente esos flujos y se establece cómo corregir errores sin crear una deuda fiscal.

## P0 — impiden lanzar el alcance solicitado

| Orden | Brecha | Capacidades | Efecto concreto | Dependencias y evidencia de cierre |
|---|---|---|---|---|
| 1 | Determinar matriz fiscal de cuotas, pagos, anticipos, créditos, exención y CABYS por entidad | C23,C27,C29,C30,C20 | Un pago no determina por sí solo cuándo nace la obligación de facturar ni si es exento. Riesgo de documento e IVA incorrectos | Dictamen tributario por concepto y emisor, reglas versionadas; casos contables aprobados |
| 2 | Completar y probar FE exenta real | C23,C33,C48,C49 | La ruta local conserva `01/10`, pero no se ha probado la cuota exenta con Hacienda STAG ni la elegibilidad del concepto | XML/XSD actualizado, PDF, idempotencia y aceptación STAG con muestra autorizada; no inferir exención por impuesto cero |
| 3 | Notas de crédito total y parcial con referencias y saldo corregible | C15,C16,C37 | No se puede revertir pago facturado ni corregir una línea aceptada | Tipo/tabla/API/XSD/firma/entrega, vínculo a original aceptado, acumulación que impida crédito superior, pruebas STAG |
| 4 | Nota de débito | C17 | No se puede aumentar/corregir importe mediante documento válido | Mismo núcleo correctivo; casos de referencia y conciliación |
| 5 | Contrato de pagos y factura multiobligación | C29,C30,C31,C38,C45,C54 | Pago parcial/múltiple/anticipado puede duplicar fiscalización o perder período y montos | Decidir una o varias facturas por transacción; identidad fiscal por asignación, líneas por concepto/período, suma y redondeo deterministas |
| 6 | Manejo de rechazo y sustitución sin duplicar cobro | C37,C39,C43 | Un `REJECTED` deja el pago en estado ambiguo; el consumidor puede reintentar creando otro documento o emitir NC indebidamente | Máquina de estados entre sistemas; lookup por idempotencia; reemplazo con nueva identidad fiscal según causa; simulación de interrupciones |
| 7 | Acceso M2M independiente para afiliaciones y aislamiento cruzado | C03,C11,C12,C45 | Reutilizar perfil o clave de Inventori comparte autoridad y dificulta revocación/auditoría | Perfil/scopes de afiliaciones, clave por empresa y ambiente, pruebas positivas/negativas tenant, empresa, API key y tipo |
| 8 | Congelar versión fiscal y reconciliar migraciones/despliegue | C33,C50,C53 | Fuente local, STAG histórico y runtime actual pueden diferir; los archivos `202611*` son futuros respecto a este corte | Comparar anexos oficiales actualizados, XSD, migraciones aplicadas/checksums, imagen inmutable y aprobaciones de producción |

**Alcance tributario condicional:** El REP (C20) pasa a P0 si el modelo de crédito/pago diferido de la entidad cumple los supuestos del Decreto 44739-H; no debe emitirse un REP por cada pago parcial automáticamente. Un especialista fiscal debe fijar esa regla antes de diseño final. Factura de exportación (C19) pasa a P0 para servicios exportados; no todo receptor extranjero implica exportación.

## P1 — operación fiscal completa

| Brecha | Capacidades | Cierre esperado |
|---|---|---|
| No sujeción, 0 % con crédito y exoneraciones | C24,C25,C26 | Contrato tributario explícito, soportes de exoneración, cálculo/desglose y aceptación de muestras aplicables |
| TE real, clientes extranjeros y divisas | C14,C31,C32,C49 | STAG TE; contrato de identificaciones extranjeras, moneda/tasa congelada y FEE cuando corresponda |
| REP cuando aplique y otros comprobantes necesarios al emisor | C18–C21 | Decisión fiscal por tipo; implementación y pruebas solo de los aplicables, con recepción/confirmación si el rol lo exige |
| Sucursales/terminales, políticas de secuencia | C06,C07 | Administración segura, numeración sin saltos y cambio de plataforma reconciliado |
| Contratos y eventos operativos | C43,C45 | OpenAPI versionado de todas las operaciones; webhook firmado o polling contractual con cursor, reintentos y deduplicación |
| Entrega y conservación verificadas | C40–C42,C44,C51 | SMTP y rebotes, recuperación de XML/PDF/respuesta, restauración, retención y acceso auditado |
| Observabilidad y continuidad | C39,C52,C53 | Métricas de pendientes/rechazos/reintentos, alertas, runbooks y simulacros de caída |

## P2 — extensiones después de los flujos comprometidos

| Brecha | Capacidades | Motivo |
|---|---|---|
| Catálogo fiscal ampliado y otros impuestos | C26,C27 | Priorizar solo tratamientos usados por emisores reales; mantener actualización continua |
| Configuración avanzada de precios incluidos y monedas adicionales | C29,C31 | Puede normalizarse en el productor si el contrato conserva base e impuesto exactos; probar equivalencia |
| Automatización administrativa y reportes | C06,C12,C44 | Reduce operación manual después de fijar controles fiscales |

## Impacto en Inventori

También afectan a Inventori: notas correctivas C15–C17, tratamientos tributarios C23–C27, divisas/receptores C31–C32, actualización XML/XSD C33, rechazo/recuperación C37–C39, aislamiento C11, documentos/entrega C40–C42 y despliegue C50–C53. El cambio a una API de notas o de tax metadata exige compatibilidad de su cliente y pruebas de contrato; **no** autoriza editar Inventori en este diagnóstico. Las capacidades comerciales de períodos, saldos y aplicaciones de pagos pertenecen exclusivamente al nuevo sistema (C54).

## Decisiones de producto aún abiertas

1. ¿Se factura el período devengado, el cobro, o un anticipo bajo la regla fiscal de cada emisor? Esta decisión se resuelve jurídicamente; la API debe aceptar un hecho fiscal ya decidido.
2. ¿Una transacción con varias afiliaciones produce una FE con líneas separadas o varias FE? Ambas requieren identidad fiscal estable, trazabilidad de asignaciones y manejo de reversos por línea.
3. ¿Qué clientes requieren FE frente a TE, y cuáles son extranjeros/exportación? No convertir esto en heurística basada solo en nombre o moneda.
4. ¿Se necesita evento saliente en tiempo real o basta polling garantizado? Para lanzamiento sin webhook, documentar latencia, cursor/ETag, límites y recuperación.
