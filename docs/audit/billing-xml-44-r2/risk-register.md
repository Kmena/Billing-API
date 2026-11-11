# BILLING-XML-44-R2 — registro de riesgos

| Riesgo o dependencia | Evidencia | Tratamiento en R2 | Condición antes de repetir W2-B |
|---|---|---|---|
| Política fiscal real por plan | Afiliaciones W2-A solo tiene perfiles sintéticos exento/IVA 13 % | No se infiere categoría de `taxAmount=0`; entrada ambigua rechazada | Aprobar fuente y evidencia del tratamiento de cada plan |
| Exoneración | DTO v1 carece de datos para `Exoneracion` | `EXONERATION_CONTRACT_GAP`, sin XML ficticio | Versionar contrato y validar documento/importe si se requiere |
| IVA 0 % sin crédito | Código `11` requiere clasificación/resumen distintos | Rechazo explícito | Diseño fiscal y de resumen separado |
| Tarifas/códigos adicionales | El serializador R1 solo implementa códigos IVA 01/07; la nueva comprobación aritmética explícita cubre 13 % y 4 % estándar | Otros códigos no se amplían aquí | Revisar por código antes de incluir nuevos planes/productos |
| Timeout XSD bajo carga | R1 tuvo una falla con límite 10 s; repetición aislada pasó. Revisión R2 con 10 s: 402/402 unitarias y 5/5 E2E de firma/persistencia | Se conserva el límite de producto de 10 s; un agotamiento falla cerrado y queda clasificado. Los dos niveles de validación aumentan el trabajo por documento | Medir duración de cada pasada XSD y capacidad del proceso de preparación antes de repetir W2-B |
| Concurrencia de creación | R1 observó 10/12 creaciones en corrida amplia y 7/7 en repetición aislada | Se repite bajo laboratorio descartable; no se modifica asignación ni Prisma | Cualquier falla persistente bloquea declaración de regresión integral limpia |
| Sensibilidad a carga en E2E | Primera corrida R2: dos pruebas superaron el límite Jest de 60 s; `fiscal-documents` tardó 229 s y `fiscal-concurrency` 124 s. Segunda corrida: 20/20 en 105,5 s | Se conserva el FAIL inicial y se investiga la diferencia de carga; no se eleva el límite Jest para ocultarlo | Medir latencia y repetir en un host con carga controlada antes de autorizar promoción |
| Fixtures antiguos de impuestos | La primera regresión unitaria usaba solicitudes sin metadatos y un descuento con impuesto calculado sobre la base anterior | Se corrigieron solo datos sintéticos de prueba para que autorización, actividad y descuento sigan siendo comprobables | Mantener fixtures fiscales válidos en futuras suites |
| Imagen instalada y ledger | El checkout Billing instalado difiere de la rama de referencia; R1 no promovió código | Solo se verifican laboratorio y SHA de la rama; no se toca instalación | Reconciliar imagen, esquema y migraciones instaladas por proceso separado |
| Timeout Prisma/P2028 de W2-B | Bloqueo previo independiente del XML | Fuera de alcance | Resolver/autorizar por separado |
| Aceptación de Hacienda | Solo XSD y firma sintética sin red | No se comunica con Hacienda | Validación fiscal autorizada en fase posterior; no asumir aceptación |

La comparación byte a byte del XML antes/después de la firma depende del firmador XAdES configurado, que inserta un único nodo `ds:Signature`. Si se sustituye ese firmador, debe verificarse que preserve los mismos bytes fiscales o adaptar la comprobación con una canonicalización aprobada. Ningún riesgo de esta lista autoriza cambios en Afiliaciones, imágenes instaladas o bases persistentes durante R2.
