# Actualización de Billing desde `main` · procedimiento preparado

**Estado:** PREPARADO PARA REVISIÓN, SIN EJECUCIÓN. El único comando existente **en la rama candidata**, `node scripts/update-billing-from-main.mjs --apply --expected-sha=<40-hex>`, actualiza **solo el checkout Git** por fast-forward desde `origin/main`. Requiere `main` limpio y SHA revisado; no compila, respalda, migra, reinicia API/worker ni comprueba salud. Se verificaron `--help`, rechazo fuera de `main` y rechazo de `--apply` sin SHA. No se ejecutó `--apply`. El checkout principal actual (`7-conexion_m2m`) todavía no contiene este script; estará disponible allí solo cuando el código correspondiente se integre por un proceso autorizado.

## Secuencia requerida para un futuro comando integral

| Orden | Precondición/acción | Verificación y detención segura |
|---|---|---|
| 1 | Fijar SHA exacto de `main` ya revisado; exigir checkout `main` limpio y fast-forward. | Abortarlo si cambió `origin/main`, la rama, el árbol o el SHA. No hacer reset. |
| 2 | Ejecutar preflight DBA **solo lectura** de `_prisma_migrations` y objetos; comparar 27 nombres/checksums y 16 divergencias. | Abortarlo por historial desconocido, pendiente, divergencia funcional o lock no evaluado. No usar `migrate resolve` automático. |
| 3 | Crear respaldo nuevo de DB, artefactos fiscales y almacén de secretos cifrados; custodiar la clave maestra por separado; ensayar restauración. | Verificar hashes, recuperación y punto de retorno antes de tocar código o servicios. |
| 4 | Construir imagen/artefacto del SHA fijo; registrar digest de API y worker. | Abortarlo si el digest o la configuración efectiva no coincide. |
| 5 | Aplicar solo DDL aprobado en ventana separada; actualizar API y worker como una unidad compatible; mantener v2 desactivado. | No ejecutar este paso sin autorización DBA/operación y prueba de restore. No recrear dependencias ni volúmenes. |
| 6 | Comprobar `/health`, estado worker, almacenamiento/secretos, 42 rutas v1 y consulta de operaciones; observar errores y colas. | Ante fallo, detener avance, conservar logs/evidencia y volver al binario previo compatible. Nunca borrar filas/columnas v2 para retroceder. |

## Comando disponible hoy

Desde un futuro checkout `main` limpio que ya contenga este script, el modo predeterminado `node scripts/update-billing-from-main.mjs` es preflight Git de solo lectura. Tras una aprobación futura del avance de código, `node scripts/update-billing-from-main.mjs --apply --expected-sha=<SHA_REVISADO>` puede ejecutar **únicamente** el fast-forward. El comando no se ejecutó en este trabajo.

No se presenta un comando único de despliegue como operativo: faltan conexión/autorización DBA objetivo, destino y prueba de backup/restore, topología real de API/worker, mecanismo de rollout/rollback y endpoints de salud del entorno. El `docker-compose.yml` del repositorio se declara de desarrollo; reutilizarlo como despliegue productivo sería una suposición insegura. Cuando operaciones aporte esos parámetros y apruebe la ventana, el adaptador de despliegue deberá ejecutar la secuencia anterior con salida no cero ante cualquier fallo y sin activar rutas v2 hasta su gate específico. `STAGING_READINESS` y `PRODUCTION_READINESS` permanecen `NOT_READY`.
