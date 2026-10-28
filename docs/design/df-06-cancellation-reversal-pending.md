# DF-06 — Referencias y tratamiento de anulación y reversión

**Estado:** PENDIENTE DE DICTAMEN TRIBUTARIO. Este registro no aprueba emisión fiscal.

La [matriz normativa dirigida del 2026-10-28](df-06-normative-matrix-2026-10-28.md) documenta la evidencia oficial y las conclusiones técnicas. El anexo v4.4 contempla expresamente la ND que elimina una NC completa y la referencia `TipoDocIR=03`; el código `01` es candidato para anular el documento referenciado. Esa constatación no sustituye la aprobación tributaria del código, período e impuestos del caso concreto.

## Decisión funcional recibida del operador

Anulación ordinaria por NC total; nueva FE opcional y expresamente confirmada; reversión por ND contra la NC original; si la sustituta está aceptada, NC total de la sustituta y aceptación de esa NC antes de preparar la ND. Los documentos rechazados siguen una corrección distinta.

## Preguntas fiscales por resolver

1. ¿Es tributariamente válida la ND que referencia directamente la NC original para revertir su efecto? ¿Qué `TipoDocIR`, código, motivo y `FechaEmisionIR` se permiten?
2. ¿Qué importes, bases e impuestos debe reproducir esa ND si la NC original se originó en una FE gravada, exenta, mixta o histórica?
3. ¿Qué estados oficiales de NC y FE bastan para cada transición y qué ocurre con rechazo, contingencia o aceptación tardía?
4. ¿Es válida la secuencia FE original → NC original → FE sustituta → NC sustituta → ND de reversión, y qué período/efecto contable corresponde a cada documento?
5. ¿Qué XSD y catálogo, con hash y vigencia, aplican a cada tipo, incluidos documentos originales de versión anterior y la discrepancia de código `02` ya observada?
6. ¿Qué procedimiento supervisado corrige un rechazo de NC sustituta o de ND sin borrar ni alterar documentos previos?

Hasta contar con respuesta firmada y versionada, `BLOCKED_FISCAL_POLICY` es terminal para la emisión de ND. El laboratorio conserva un plan validado y con hash que referencia directamente la NC original; puede generar, validar contra el XSD archivado y firmar **solo una previsualización sintética no persistida**. No reserva clave/consecutivo ni actualiza el estado comercial a reversión completa.
