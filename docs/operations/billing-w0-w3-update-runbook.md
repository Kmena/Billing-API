# Actualización de Billing desde `main` · procedimiento preparado

**Estado:** comando STAG implementado y probado con checkout Git efímero y ejecutores simulados; **no instalado ni ejecutado en un servidor**. `scripts/billing-update` es el punto de entrada instalable como `sudo billing-update`; `scripts/billing-update.mjs` encadena gates. El script anterior `update-billing-from-main.mjs` continúa disponible para actualizar solo código. Esta rama aún no se ha integrado a `main`.

## Instalación futura y configuración requerida

Operaciones debe instalar un symlink de `scripts/billing-update` en `/usr/local/sbin/billing-update` **solo después del gate STAG y autorización de despliegue**. El wrapper resuelve el script real y llama a Node 24. `sudo billing-update --check` consulta el checkout y el `origin/main` local sin fetch ni comandos externos. `sudo billing-update` es el modo de aplicación, requiere uid root y `/etc/billing/billing-update.json` propiedad de root, sin escritura por grupo/otros. El archivo debe ser revisado por operaciones y contener `version: 1`, `environment: staging`, `checkout` absoluto, `approvedSha` exacto de 40 hex, `resultLog` absoluto fuera del checkout y las siete fases siguientes, cada una con `file` absoluto y `args` de texto. Los ejecutores tampoco deben recibir secretos en argumentos. El script ejecuta archivos directamente sin shell ni `eval`; su salida de error no incorpora stdout/stderr de ejecutores.

| Fase de configuración | Contrato del comando local provisto por operaciones |
|---|---|
| `configurationCheck` | Comprueba configuración efectiva de STAG, aislamiento de producción, rutas y montajes persistentes, secretos disponibles sin mostrarlos, v2 desactivado y ejecutores instalados. |
| `migrationPreflight` | Solo lectura: compara nombres/checksums y esquema objetivo con el reporte DBA aprobado; salida no cero bloquea. No aplica DDL. |
| `backup` | Respalda DB, artefactos y secretos; imprime únicamente la ruta absoluta de un manifiesto del respaldo verificado. |
| `restoreVerification` | Recibe la ruta del manifiesto como último argumento, prueba restauración en entorno descartable y verifica hashes; salida no cero bloquea. |
| `updateApi` | Despliega el SHA aprobado de API mediante la topología propia del servidor, sin activar v2 automáticamente. |
| `updateWorkers` | Despliega workers compatibles con la API y deja evidencia de digest. |
| `healthCheck` | Comprueba salud de API/worker, colas, almacenamiento y contratos críticos; salida no cero marca actualización fallida. |

Ejemplo de forma, con **rutas intencionalmente no operativas**:

```json
{
  "version": 1,
  "environment": "staging",
  "checkout": "/RUTA/APROBADA/Billing",
  "resultLog": "/RUTA/APROBADA/RESULTADOS/update.jsonl",
  "approvedSha": "0000000000000000000000000000000000000000",
  "configurationCheck": { "file": "/RUTA/APROBADA/check-config", "args": [] },
  "migrationPreflight": { "file": "/RUTA/APROBADA/preflight", "args": [] },
  "backup": { "file": "/RUTA/APROBADA/backup", "args": [] },
  "restoreVerification": { "file": "/RUTA/APROBADA/verify-restore", "args": [] },
  "updateApi": { "file": "/RUTA/APROBADA/update-api", "args": [] },
  "updateWorkers": { "file": "/RUTA/APROBADA/update-workers", "args": [] },
  "healthCheck": { "file": "/RUTA/APROBADA/health", "args": [] }
}
```

El comando exige checkout `main` limpio, SHA remoto igual al aprobado y fast-forward. Luego ejecuta comprobación de configuración, preflight, backup, prueba de restore, fast-forward, API, workers y health en ese orden. Falla en el primer paso que devuelva error; **no** ejecuta `prisma migrate deploy` por sí mismo ni cambia la base real. Escribe eventos `STARTED`, `SUCCEEDED` o `FAILED` con fase y SHA en `resultLog`, sin registrar salida de ejecutores. El lock exclusivo `/etc/billing/billing-update.json.lock` impide dos aplicaciones simultáneas; si queda tras una interrupción abrupta, operaciones debe verificar procesos y evidencia antes de retirarlo. Si falla tras actualizar código o servicios, operaciones debe usar el procedimiento de rollback de binarios compatible con el esquema aprobado; el comando conserva el backup y no borra datos. La integración real depende de scripts locales revisados, prueba STAG de restore/rollout/rollback, DBA y ventana autorizada. No se ejecutó `sudo billing-update`.

## Controles exigidos al adaptar el comando al servidor

| Orden | Precondición/acción | Verificación y detención segura |
|---|---|---|
| 1 | Fijar SHA exacto de `main` ya revisado; exigir checkout `main` limpio y fast-forward. | Abortarlo si cambió `origin/main`, la rama, el árbol o el SHA. No hacer reset. |
| 2 | Ejecutar preflight DBA **solo lectura** de `_prisma_migrations` y objetos; comparar 27 nombres/checksums y 16 divergencias. | Abortarlo por historial desconocido, pendiente, divergencia funcional o lock no evaluado. No usar `migrate resolve` automático. |
| 3 | Crear respaldo nuevo de DB, artefactos fiscales y almacén de secretos cifrados; custodiar la clave maestra por separado; ensayar restauración. | Verificar hashes, recuperación y punto de retorno antes de tocar código o servicios. |
| 4 | Construir imagen/artefacto del SHA fijo; registrar digest de API y worker. | Abortarlo si el digest o la configuración efectiva no coincide. |
| 5 | Aplicar solo DDL aprobado en ventana separada; actualizar API y worker como una unidad compatible; mantener v2 desactivado. | No ejecutar este paso sin autorización DBA/operación y prueba de restore. No recrear dependencias ni volúmenes. |
| 6 | Comprobar `/health`, estado worker, almacenamiento/secretos, 42 rutas v1 y consulta de operaciones; observar errores y colas. | Ante fallo, detener avance, conservar logs/evidencia y volver al binario previo compatible. Nunca borrar filas/columnas v2 para retroceder. |

## Comando Git anterior

Desde un futuro checkout `main` limpio que ya contenga este script, el modo predeterminado `node scripts/update-billing-from-main.mjs` es preflight Git de solo lectura. Tras una aprobación futura del avance de código, `node scripts/update-billing-from-main.mjs --apply --expected-sha=<SHA_REVISADO>` puede ejecutar **únicamente** el fast-forward. El comando no se ejecutó en este trabajo.

El comando integral permanece **no operativo** hasta que operaciones proporcione y pruebe los siete ejecutores del destino, el preflight DBA, backup/restore, rollout/rollback y health checks. El `docker-compose.yml` del repositorio es de desarrollo. `STAGING_READINESS` y `PRODUCTION_READINESS` permanecen `NOT_READY`.
