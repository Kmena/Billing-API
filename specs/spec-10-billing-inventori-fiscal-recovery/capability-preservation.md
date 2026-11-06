# Matriz de capacidades a preservar

**Leyenda:** `CÓDIGO` = ruta/servicio presente; `LAB` = prueba sintética; `INSTALADO` = metadatos/estado observable en Docker; `STAG` = aceptación oficial demostrada. Una prueba XSD o mock no constituye aceptación fiscal. Los casos de NC/ND están limitados a sus contratos de laboratorio y decisiones DF-06.

| Capacidad | Evidencia actual | Nivel acreditado | Gate pendiente |
| --- | --- | --- | --- |
| FE | Servicio v1 y v2, XML/firma; F4-S FE aceptada | CÓDIGO + LAB + STAG histórico de Billing | Prueba continua Inventori y Afiliaciones con una nueva FE STAG, previa autorización. |
| NC total/parcial/remanente | `w3-a-lab-correction`, 26 pruebas E2E focales aprobadas en PG descartable; referencias y XML firmado | CÓDIGO + LAB | Dictamen DF-06/ADR-BIL-014, vigencia XSD y aceptación STAG por escenario. |
| ND gravada/exenta y por línea | Servicio W3, pruebas sintéticas incluidas | CÓDIGO + LAB limitado | No afirmar emisión externa; reglas tributarias y referencias pendientes. |
| Reversión de NC mediante ND | `cancellation-workflow-lab.service.ts` devuelve `BLOCKED_FISCAL_POLICY`; DF-06 conserva `issuanceAllowed=false` | Preparación LAB, **emisión bloqueada** | Decisión fiscal DF-06; no desbloquearla en SPEC-10. |
| Referencias y sustitución | `cancellation-replacement-draft`, prueba W3; fuente, clave y consecutivo vinculados | CÓDIGO + LAB | Reglas de sustitución fiscal y validación externa. |
| Sucursales/terminales | Tablas y guardas de emisión presentes; ambas bases tienen 1+1 | CÓDIGO + INSTALADO | Reconciliar IDs internos y evitar doble uso del mismo punto. |
| Consecutivos por emisor/tipo | `fiscal_sequences`; un registro INVOICE/SANDBOX en cada base | CÓDIGO + INSTALADO | Un solo asignador para emisión nueva; rangos instalados distintos, riesgo futuro de colisión. |
| Actividad económica | Perfil y catálogo por empresa; un código coincidente en ambas bases | CÓDIGO + INSTALADO | Validar vigencia y tratar cambios sin sobrescribir histórico. |
| CABYS | Serializador `CodigoCABYS`; F4-S corrigió CAByS; pruebas de formato | CÓDIGO + LAB + STAG histórico FE | Validar catálogo vigente por línea y emisor. |
| Exención y exoneración | Exento sintético en W3/W5; serializador rechaza tratamientos cero no mapeados y no emite exoneración general | CÓDIGO parcial + LAB | **Exoneración no declarada funcional**; aprobar mapeos, XSD, pruebas y STAG. |
| Períodos y varias líneas | DTO/snapshot soportan líneas; W5 histórico incluye dos períodos, pero su suite no pasó en esta sesión por falta de base Afiliaciones descartable | CÓDIGO + evidencia histórica LAB | Ensayo continuo con versión actual y período realmente pagado. |
| Certificados/firma | P12 y PIN bajo Billing; F4-S XAdES aceptado; una huella activa coincide entre bases | CÓDIGO + INSTALADO + STAG histórico FE | Recuperación de almacén y firma sintética por ambos contratos. |
| Inventori v1 | `X-API-Key`, empresa, idempotencia, rutas v1; 37/37 tests de cliente | CÓDIGO + LAB | E2E continuo desde Inventori con Billing objetivo. |
| Afiliaciones v2 | Asociación/scopes M2M, outbox y módulos de FE; emisión instalada apagada | CÓDIGO + LAB parcial + INSTALADO | E2E actual de pago aprobado→FE sin otro Billing ni datos reales. |
| Idempotencia/auditoría/recuperación | APIs, claves, cola, ledger y tests W3/F3; 202→GET preservado | CÓDIGO + LAB | Concurrencia cruzada y recuperación tras reinicio en ensayo de transición. |
| PDF/XML/respuesta y correo | Artefactos, descarga y entrega Billing; SMTP real apagado; suites separadas con mock | CÓDIGO + LAB parcial | Una prueba continua con paquete íntegro y SMTP capturado; luego prueba real autorizada. |

La suite W5 `invoice-xml-affiliations.e2e-spec.ts` se intentó en PG Billing descartable y quedó **sin ejecutar su caso** porque requiere `AFILIACIONES_W5_ROOT` y una segunda base Afiliaciones descartable. No se hizo pasar ese requisito por un fallo funcional ni se activó el flujo instalado. El ensayo debe usar la versión actual, cuyo doble control de pagos y evidencia difiere del fixture W5 antiguo.
