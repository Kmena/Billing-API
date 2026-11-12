# W4-B-R3 — riesgos y bloqueos

| ID | Riesgo | Estado y acción antes de promoción |
|---|---|---|
| R1 | Código de referencia, período y tratamiento de pagos NC/ND sin decisión fiscal comercial | Emisión real bloqueada; obtener aprobación fiscal. El catálogo de R3 solo valida estructura XSD. |
| R2 | `main` diverge de R1/R2/R3 | Integrar selectivamente en candidato nuevo y ejecutar regresión allí. |
| R3 | Base instalada puede tener historial de migraciones distinto | Comparar `_prisma_migrations` y checksums en candidato descartable; planificar migración, nunca reparar base instalada en esta fase. |
| R4 | Momento preciso de commit en POST interrumpido no controlado | La prueba cubre respuesta perdida, replay confirmado y reserva incierta; añadir inyección determinista de fallo transaccional en candidato si se exige prueba por frontera temporal. |
| R5 | Hook PDF asíncrono registra error tras teardown de tres suites E2E | Las 18 pruebas pasan; revisar cierre de tareas del harness antes de usarlo como gate de despliegue. |
| R6 | Firma y XSD son locales con identidad sintética | No equivalen a aceptación fiscal; revisión de certificado, políticas y Hacienda requiere fase autorizada separada. |
| R7 | Módulo de laboratorio podría importarse por error en otro entrypoint | Mantener fuera de `AppModule`; constructor `NODE_ENV=test` y gates internos; revisión de imports al integrar. |

No hubo FAIL ni SKIP en las 93 pruebas seleccionadas. Los riesgos R1–R3 y R6–R7 bloquean promoción o emisión real; R4–R5 limitan la extrapolación de la evidencia de laboratorio.
