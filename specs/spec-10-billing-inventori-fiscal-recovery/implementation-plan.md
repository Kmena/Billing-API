# SDD — Plan de implementación y recuperación

Estado: propuesta, **sin autorización operativa**.

## Waves

1. **Inventario forense:** identificar SHA efectivo de la imagen histórica (no inferir por tag); comparar `prisma/migrations` y `_prisma_migrations` de ambas bases, checksums, contadores por emisor/ambiente/tipo, claves y prefijos de consecutivo. Inventariar referencias de secret stores, artefactos y entrega sin extraer bytes secretos. Registrar también el ledger y configuración de cada consumidor. Solo lectura y respaldos restaurables.
2. **Contrato canónico:** fijar DTO versionado para snapshot fiscal, idempotencia, estado y artefactos. Publicar OpenAPI; mapping explícito de v1 Inventori y v2 Afiliaciones. Verificar scopes, asociación y ambiente transaccionalmente. Ningún campo `null` debe sobrescribir perfil existente.
3. **Paridad local:** prueba HTTP continua Inventori→Billing y Afiliaciones→Billing en entornos descartables, certificados sintéticos, Hacienda 202/GET aceptado simulados, SMTP capturado. Repetir con errores, reinicio, concurrencia y duplicados. Reparar las tareas PDF tardías si persisten fuera del harness.
4. **Reconciliación de datos:** decidir instancia destino por empresa. Preparar importación **no destructiva** de perfiles y referencias protegidas con claves de cifrado recuperables, o preservar perfil donde está y usar routing. Reconciliar secuencias por emisor/ambiente/tipo; conservar todos los documentos y claves originales. Ensayar rollback sobre restauraciones, no sobre producción.
5. **Transición por consumidor:** mantener ambos Billing activos. Migrar primero lectura/artefactos; después una sola empresa SANDBOX de nueva emisión con bloqueo de doble escritura. Verificar idempotencia cruzada, aceptación simulada, salud, persistencia y continuidad. Producción requiere autorización distinta.
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
