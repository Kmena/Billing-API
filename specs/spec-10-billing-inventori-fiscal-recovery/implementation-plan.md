# SDD — Plan de implementación y recuperación

Estado: propuesta, **sin autorización operativa**.

## Waves

1. **Inventario forense:** conservar el inventario agregado ya realizado (`installation-reconciliation.md`). Identificar SHA efectivo de fuente de la imagen histórica, clasificar su migración aplicada ausente de la imagen y verificar el esquema resultante. No cambiar los 19 checksums distintos que corresponden a CRLF. Completar metadatos de secret stores, artefactos y entrega sin extraer bytes secretos. Solo lectura y respaldos restaurables.
2. **Contrato canónico:** fijar DTO versionado para snapshot fiscal, idempotencia, estado y artefactos. Publicar OpenAPI; mapping explícito de v1 Inventori y v2 Afiliaciones. Verificar scopes, asociación y ambiente transaccionalmente. Ningún campo `null` debe sobrescribir perfil existente.
3. **Paridad local:** ejecutar T1–T4 de `e2e-fiscal-acceptance.md` con dos bases descartables, certificados sintéticos, Hacienda 202/GET aceptado simulados y SMTP capturado. Repetir con errores, reinicio, concurrencia y duplicados. Cerrar tareas PDF tardías antes del teardown.
4. **Reconciliación de datos:** conservar SPEC-09 como código objetivo, decidir su base física y la forma de acceso a documentos históricos. Preparar importación **no destructiva** de perfiles y referencias protegidas con claves de cifrado recuperables, o preservar perfil donde está y usar routing. Para la misma identidad/punto/tipo, un solo asignador debe partir de un valor posterior al máximo verificado; conservar todos los documentos y claves originales. Ensayar rollback sobre restauraciones, no sobre la instalación.
5. **Transición por consumidor:** mantener ambos Billing activos. Migrar primero lectura/artefactos; después dirigir la única empresa fiscal de pruebas a un solo Billing para nueva emisión, con bloqueo de doble escritura y control de secuencia. Verificar idempotencia cruzada, aceptación simulada, salud, persistencia y continuidad. STAG real y producción requieren autorizaciones distintas.
6. **Retiro:** solo tras inventario de documentos, remesas y entrega, zero pending, respaldos independientes, reconciliación de estados y observación de consumidores. El Billing histórico puede permanecer en solo lectura para expedientes antiguos.

## Migraciones y compatibilidad

No se propone DDL en este diseño. Cualquier migración futura debe partir del ledger real y checksum, ser aditiva y ensayarse en restauraciones. No renombrar ni volver a ejecutar migraciones históricas aplicadas. La fuente histórica de cada documento se identifica antes de mover referencias. Inventori conserva v1 (`X-API-Key`) mientras se pruebe paridad del contrato nuevo; Afiliaciones mantiene v2. Una ruta común de negocio puede usar dos adaptadores de autenticación sin duplicar XML/OAuth/Hacienda.

## Protección y rollback

Antes de una futura ventana: respaldo consistente de ambas bases, artefactos, almacenes cifrados y material de recuperación; restauración aislada con verificación de huellas, conteos, referencias, claves y usuarios. Registrar bandera y commit de cada imagen. Pausar emisión durante cambio de dueño de secuencia, no iniciar imágenes antiguas sobre esquema incompatible. Rollback = revertir routing/imagen solo si no hubo emisión nueva, o restauración controlada del conjunto completo tras decisión fiscal explícita. Nunca restablecer únicamente PostgreSQL si faltan artefactos o claves. La factura en MRR requiere expediente separado y no un reintento por despliegue.

## Criterios de aceptación

- Una sola autoridad para **nueva** factura por empresa/ambiente; cero doble secuencia o doble POST.
- Inventori v1 y Afiliaciones v2 pasan autorización, aislamiento, idempotencia y auditoría.
- XML XSD/firma y sobre HTTP equivalentes a F4-S; 202 no equivale a aceptado; GET oficial concluyente sí actualiza estado.
- PDF/XML/respuesta y entrega SMTP simulada asociados a la misma clave; ningún secreto en logs.
- Documentos históricos consultables sin alteración; respaldos y rollback probados.
- Producción y correo real permanecen deshabilitados hasta autorizaciones posteriores.
- NC/ND y exoneración se clasifican por contrato y evidencia, sin elevar tests sintéticos a aceptación fiscal; DF-06 mantiene sus bloqueos.
