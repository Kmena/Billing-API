# ADR-BIL-016 — Versión normativa de documentos correctivos

**Estado:** pendiente de aprobación fiscal y de arquitectura. 2026-10-28.

La decisión funcional de ADR-BIL-014 no fija la versión del XSD, catálogos ni códigos de referencia de una NC o ND. Los documentos FE/NC y la previsualización ND de este laboratorio usan los recursos v4.4 ya fijados por el repositorio para pruebas sintéticas. La [matriz DF-06](df-06-normative-matrix-2026-10-28.md) registra los SHA-256 de NC/ND y las fuentes oficiales. La validación XML/XSD y la firma acreditan la estructura y la integridad de esos artefactos de prueba, no su vigencia ni aceptación por Hacienda. La descarga actual de ambos XSD no pudo verificarse en esta revisión.

Antes de autorizar operaciones fuera del laboratorio, el responsable fiscal y arquitectura deben fijar por tipo documental: fuente oficial, bytes y hash, vigencia temporal, catálogo de referencia y criterio de selección para notas sobre documentos históricos de otra versión. DF-06 debe resolver la discrepancia documentada entre la descripción del código `02` en el anexo y la anotación del XSD NC. También debe definir el código y el tratamiento fiscal de la ND de reversión que referencia directamente una NC; el software mantiene bloqueada esa emisión hasta entonces.

La aprobación debe quedar versionada y vinculada a casos de prueba y a una migración o configuración explícita. Ninguna opción de borrador ni campo `policyVersion` suministrado por un consumidor constituye esa aprobación.
