# SPEC-10 — preparación de una sola factura Afiliaciones → STAG

Fecha: 2026-11-06. Rama de preparación Billing: `codex/spec10-one-stag-preparation`, basada en `a1af81ebda513d608edc62afd8159fedee759e1d`. Candidata Afiliaciones: `fd36dcb027bb3911da406534efda235edbb1ea13` en el worktree `codex/spec10-stable-fiscal-event`. No se instalaron imágenes, no se iniciaron los cinco contenedores SPEC-09, no se cambiaron bases, contadores ni configuración fiscal, y no se contactó Hacienda ni SMTP.

## Estado instalado y compatibilidad

| Control | Evidencia y resultado |
| --- | --- |
| Contenedores | Billing, PostgreSQL Billing, API Afiliaciones, Web Afiliaciones y PostgreSQL Afiliaciones siguen `Exited (255)`. No se arrancaron para evitar workers fiscales no autorizados. Billing histórico y su PostgreSQL permanecen activos y fuera de este procedimiento. |
| Imágenes actuales | Billing `sha256:53b3ab7651526879346bc692ee02046b749294b1d9c26546077ac90279119626`; API Afiliaciones `sha256:6c81eacecdd4d56130818c7779482e27ce62bbd56281368868a89d7862a0f3a2`; Web `sha256:6655dc7247ad609b5f4ae9de5f0515bf3e7534e75308a3ad6a175870429ddf2c`. Su SHA de código de origen no está certificado por etiqueta verificable. |
| Migraciones | Respaldo restaurado: Billing 32 completas y Afiliaciones 28 completas. Los commits candidatos contienen 32 y 28 directorios de migración respectivamente; no se observa migración nueva en este par de commits. Se debe comparar el ledger y sus checksums en la ventana, antes de cualquier `migrate deploy`. |
| Contrato y M2M | El código candidato conserva operaciones v2 de FE y agrega la solicitud de paquete aceptado con `fiscal-v2:deliveries:request`; la instalación tiene una asociación SANDBOX activa, pero ninguna clave instalada posee ese scope. Rotación administrativa con solapamiento y comprobación del consumidor quedan pendientes. No se leyó ninguna clave. |
| Fiscal | Perfil, actividad, punto de emisión, certificado activo y referencias protegidas presentes según clon de solo lectura anterior. Hacienda figura `CONNECTED`, que no demuestra aceptación STAG actual. El código candidato conserva XML/firma, adaptador F4-S e idempotencia; la E2E continua con certificado y Hacienda simulados ya pasó. |
| URL y flags | Configuración instalada apunta a `https://api-sandbox.comprobanteselectronicos.go.cr/recepcion/v1`; el adaptador forma `POST /recepcion` y `GET /recepcion/{clave}`. `USE_REAL_HACIENDA=false`, envío de membresías apagado, `EMAIL_USE_REAL=false` y producción inerte. No se hizo prueba de red. |
| Compose | Los 10 archivos de Billing y 17 de Afiliaciones indicados por las etiquetas de los contenedores existen. `docker compose ... config --quiet` terminó con código 15 en ambos proyectos por una dependencia de archivo de ambiente. No se mostraron valores ni se corrigió la configuración. Por ello el comando de instalación aún no está validado. |

## Respaldo nuevo y recuperación aislada

Con los cinco contenedores detenidos, se ejecutó `scripts/spec10/backup-stopped-spec09-volumes.ps1` hacia `D:\SPEC10-STAG-Prep-20261106-190121`. Su manifiesto protegido enumera cuatro volúmenes y confirma SHA-256 del archivo, huella del árbol antes/después y restauración igual en `tmpfs`, sin red: `spec09_billing_pgdata`, `aflilientions_pgdata`, `spec09_billing_fiscal_storage` y `spec09_billing_secret_store`. Marcador: `SPEC10_STOPPED_VOLUMES_BACKUP_RESTORE_PASS`. Los archivos no están en Docker ni Git, pero aún están en el mismo equipo.

`scripts/spec10/verify-cold-spec09-postgres.ps1` levantó cada copia de PostgreSQL en un contenedor descartable con datos en `tmpfs` y red deshabilitada. Resultados: `SPEC10_COLD_POSTGRES_RESTORE_PASS database=Billing counts=32|1|1|1` (migraciones/documentos/contadores/asociaciones) y `... database=Afiliaciones counts=28|3|5|1` (migraciones/clientes/pagos/outbox). No quedó contenedor de restauración. La prueba confirma recuperación física y lectura básica, no un rollback completo de API/Web ni la recuperación criptográfica del certificado.

La clave maestra **no** se copió en claro ni se incluyó en el respaldo de volúmenes. Siguen presentes los sobres cifrados `D:\SPEC09-Billing-Master-DPAPI-v2-20261104\master-key.dpapi` y `D:\SPEC09-Billing-Master-Independent-20261104\master-key.independent.json`. Su recuperación había sido probada antes; en esta fase solo se comprobó su presencia. La copia descargada de Google Drive usada en la verificación anterior no está actualmente en Descargas, de modo que la custodia externa no se revalidó. Una ventana de instalación debe verificar de nuevo el sobre independiente, el acceso a su contraseña bajo custodia del operador y una copia externa del respaldo nuevo. No se muestra ninguna huella reutilizable de secretos en este informe.

### Comandos reproducibles de respaldo/validación

Desde el worktree Billing, con Docker autorizado y los cinco contenedores SPEC-09 detenidos:

```powershell
& .\scripts\spec10\backup-stopped-spec09-volumes.ps1 -Destination 'D:\SPEC10-<ventana-nueva>'
& .\scripts\spec10\verify-cold-spec09-postgres.ps1 -BackupDirectory 'D:\SPEC10-<ventana-nueva>' -Database Billing
& .\scripts\spec10\verify-cold-spec09-postgres.ps1 -BackupDirectory 'D:\SPEC10-<ventana-nueva>' -Database Afiliaciones
```

Cada ventana exige un destino **nuevo**. Los scripts abortan si los contenedores están activos, cambia una fuente durante el respaldo, falla un SHA o falla la restauración. No sustituyen el ensayo de descifrado de los sobres ni un respaldo fuera del equipo.

## Consecutivo: parada obligatoria

La fuente histórica registra 1–7 consumidos para el mismo emisor fiscal, SANDBOX, sucursal `001`, terminal `00001` y FE. En SPEC-09 existe otra FE con consecutivo 1 y estado `MANUAL_REVIEW_REQUIRED`. Su contador marca `next_value=2`. Es una colisión real entre instalaciones. El 8 es **solo el piso observado**. El Billing histórico permanece activo; su ledger podría avanzar. No se ha cerrado el inventario de otros sistemas autorizados ni existe dictamen fiscal documentado sobre la duplicación del 1. Por tanto `authorizedNextValue=null`, `SEQUENCE_READY=BLOCKED` y no se debe reservar, crear ni enviar una FE nueva.

Para liberar el gate: (1) obtener del responsable fiscal el inventario completo y ledger externo usado/reservado para esa identidad, ambiente y punto; (2) resolver documentalmente la colisión del 1; (3) congelar todos los escritores fiscales; (4) releer ambas bases, auditoría, reservas y artefactos; (5) calcular y aprobar el contador por emisor/sucursal/terminal/tipo; (6) ensayar el corte en clones; (7) solicitar autorización específica para aplicarlo. La ausencia de una fila SQL no libera un consecutivo. La factura anterior y su XML permanecen intactos.

## Caso nuevo de Afiliaciones

La obligación anterior de ₡113 ya tiene pago/intención fiscal y no se reutiliza. No se encontró una obligación limpia impaga en la evidencia instalada anterior. Por la parada de secuencia, **no se creó** cliente, nueva obligación ni pago persistentes en esta fase. El caso futuro se preparará mediante la API normal: período nuevo único, receptor fiscal apto, monto/impuesto/CABYS confirmados, pago SINPE con referencia y evidencia sintética, un registrador y otro aprobador, y comprobación de ausencia de intención/documento para ese evento. La aprobación y emisión quedan para la ventana separada.

## Secuencia de instalación propuesta; no ejecutada

1. Obtener autorización independiente de instalación. Reconfirmar commits y árboles limpios, contenedores e imágenes, configuración privada, flags, ledger de migraciones y checksums. Cerrar el error `compose config --quiet` antes de tocar servicios; reconstruir los argumentos `-f` en el orden exacto de `com.docker.compose.project.config_files`, sin imprimir `docker compose config` ni variables privadas.
2. Congelar escritores fiscales de **ambos** Billing. Resolver el ledger externo y la colisión; aprobar el valor de corte por dimensión. Capturar huellas fiscales y un respaldo **nuevo** de ambas bases, artefactos, almacén cifrado y dependencias de recuperación; verificar restauración, descifrado y copia fuera del equipo. Cualquier fallo detiene la ventana.
3. Construir imágenes inmutables de los commits autorizados y verificar sus etiquetas/ID. Comandos de construcción preparados, desde cada worktree exacto (no ejecutar aún):

   ```powershell
   docker build --pull=false -f Dockerfile --build-arg OCI_IMAGE_REVISION=a1af81ebda513d608edc62afd8159fedee759e1d -t billing-spec10:a1af81eb .
   docker build --pull=false -f Dockerfile.api -t afiliaciones-spec10-api:fd36dcb0 .
   docker build --pull=false -f Dockerfile.web -t afiliaciones-spec10-web:fd36dcb0 .
   ```

   La segunda y tercera líneas se ejecutan en el worktree Afiliaciones, la primera en Billing. Antes de uso, verificar `git rev-parse HEAD` y `git status --porcelain` en ambos. El arranque requiere un overlay privado final que seleccione esos IDs sin modificar los archivos Compose previos; aún no se ha creado ni validado.
4. Instalar primero Billing, manteniendo Hacienda y correo apagados; verificar salud, migraciones sin deriva, documento anterior, huellas y contratos v1/v2. Preparar clave M2M con scope mínimo de entrega mediante el procedimiento administrativo probado, con solapamiento; validar el nuevo consumidor antes de revocar la anterior. Instalar luego API/Web Afiliaciones y verificar los seis pasos y paquete completo con Hacienda/SMTP simulados. No se ejecuta `migrate deploy` si los ledgers siguen completos; nunca `migrate reset`.
5. Con autorización separada de corte, aplicar el contador aprobado bajo congelamiento y comprobar que la otra instalación no emite. Releer el ledger antes de reanudar. Solo entonces preparar el nuevo período y pago; no aprobar ni facturar hasta la autorización fiscal específica.

### Recuperación y paradas

- Antes de cualquier emisión STAG, un fallo de imagen, M2M, salud o integridad obliga a detener servicios nuevos, conservar ambas bases, artefactos y sobres, y comparar con el respaldo restaurado. Los IDs de imágenes anteriores están arriba. Las imágenes antiguas no deben arrancarse sobre un esquema incompatible; aquí no hay migraciones nuevas, pero esto debe comprobarse otra vez en la ventana.
- Tras reservar un consecutivo o contactar STAG, **no** restaurar automáticamente una copia previa ni reiniciar el emisor antiguo: podría repetir números o duplicar documentos. Congelar ambos escritores, conservar evidencia y reconciliar documento, submission, contador y Hacienda antes de cualquier recuperación.
- Parar ante diferencia fiscal no explicada, migración/checksum inesperado, scope ausente, secreto no recuperable, workers concurrentes, URL distinta de STAG, respuesta ambigua o paquete incompleto. No hacer POST ni GET durante la preparación.

## Runbook de una sola prueba STAG; requiere nueva autorización

Con contador aprobado y servicio instalado: verificar la identidad del emisor y receptor, punto de emisión, certificado/firma/XSD, OAuth STAG, flags y evento fiscal único. Aprobar el nuevo pago con otro usuario y confirmar una sola intención. Crear una sola factura idempotente en Billing, conservar XML firmado, clave y consecutivo, hacer **un** POST a `https://api-sandbox.comprobanteselectronicos.go.cr/recepcion/v1/recepcion` sin redirecciones ni reintentos automáticos, y registrar código/headers seguros. HTTP 202 no implica aceptación. Consultar por GET **esa misma clave** con límite de tiempo/intentos aprobado, sin repetir POST ante timeout. Persistir solo un estado oficial concluyente. Si es aceptado, exigir PDF, XML firmado y respuesta fiscal íntegros y pedir una entrega idempotente **simulada**; SMTP real continúa apagado. Ante rechazo o ambigüedad, conservar historia y detenerse sin crear otro documento.

## Gates al cierre

| Gate | Estado |
| --- | --- |
| `DEPLOY_READY` | `BLOCKED`: Compose no valida sin su dependencia privada; faltan verificación criptográfica y copia externa del respaldo nuevo, cierre de numeración y scope instalado. |
| `M2M_V2_READY` | `PARTIAL`: contrato y prueba sintética aprobados; instalado carece de scope de entrega y servicios detenidos. |
| `SEQUENCE_READY` | `BLOCKED`: colisión del 1 y fuentes externas abiertas; 8 no autorizado. |
| `TEST_PAYMENT_READY` | `BLOCKED`: no se creó un pago nuevo; se detuvo la preparación de emisión real. |
| `STAG_POST_READY` | `BLOCKED`: no hay consecutivo seguro ni paquete instalado. |

La aceptación fiscal STAG no se ha demostrado para esta prueba. No hay autorización de instalación ni contacto real con Hacienda en esta fase.
