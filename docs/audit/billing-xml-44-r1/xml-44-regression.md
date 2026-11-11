# BILLING-XML-44-R1 — regresión

Las suites se ejecutaron en la imagen de pruebas del worktree, sin red ni acceso a bases instaladas. El XSD TE oficial se montó de solo lectura para evitar la conversión CRLF del checkout Windows; el fixture de contrato histórico estaba sanitizado y se montó de solo lectura. Build TypeScript/Prisma del laboratorio: PASS.

| Área | Resultado |
|---|---|
| Serializador FE/TE, XSD, firma XAdES, CABYS, decimales, contrato v4.4 | 8/8 suites PASS; 144/145 pruebas PASS en la corrida amplia. La única prueba fallida fue `PrepareFiscalXmlService / processes INVOICE`, con rechazo XSD tras agotarse aparentemente el límite de 10 s del subproceso validador. |
| Preparación de XML, corrida aislada completa | 8/8 PASS, incluido INVOICE y TICKET; la prueba INVOICE aislada también pasó. La falla anterior es intermitente bajo carga y no se reproduce aislada. |
| Autorización de compañía, controlador de envío, perfil fiscal, credenciales M2M | 4/4 suites PASS, 51/51 pruebas PASS. |
| Equivalencia de payload fiscal e idempotencia de hash | 4/4 PASS al montar el fixture sanitizado. La primera ejecución no arrancó por fixture ausente de la imagen de prueba; no era un fallo de producto. |
| Validación fiscal, actividad económica, estados de envío | 3/3 suites PASS, 71/71 pruebas PASS. |
| Documentos, persistencia, concurrencia, idempotencia y firma XML E2E | 21 migraciones aplicadas solo en cada PostgreSQL descartable. Corrida documentos + persistencia: 10/10 PASS. Corrida ampliada de cuatro suites: 19/20 PASS; `CONC-001` obtuvo 10/12 solicitudes creadas bajo carga. Repetición aislada de concurrencia con `NODE_OPTIONS=--experimental-vm-modules`: 7/7 PASS, incluidos mismo idempotency key y no duplicación de consecutivos. El ensayo de firma XML E2E pasó 3/3 en la corrida ampliada. Todos los contenedores/almacenamientos temporales fueron eliminados. |
| NC/ND | SKIP: no se encontraron implementaciones/pruebas de NC/ND en el Billing de referencia `3b0893f`. |

La corrida unitaria amplia terminó con 1 fallo/145 pruebas y la repetición aislada de la suite afectada pasó 8/8. La corrida E2E ampliada terminó con 1 fallo/20 y la repetición aislada de concurrencia pasó 7/7. Ambos fallos aparecieron bajo la carga del laboratorio y no se reproducen aislados; no se atribuyen al serializador, pero impiden declarar una regresión integral limpia en una sola corrida. La segunda corrida E2E incluyó el `NODE_OPTIONS` que usa el propio runner descartable del repositorio, evitando además errores de importación dinámica en la validación PDF. No se alteró el timeout de producción del validador. La nueva suite XML usa 30 s solo en pruebas; el producto mantiene 10 s.

Se verificaron rutas E2E de documentos, idempotencia, persistencia, firma y concurrencia contra PostgreSQL temporal sin red. No se verificó un contrato M2M desplegado. El código de API, DTO, persistencia y M2M no cambió en esta rama.
