# SPEC-09: recuperación local de la clave maestra del SANDBOX persistente

Estado al 4 de noviembre de 2026: **parcial; no autoriza instalar en 3081**. Este procedimiento solo aplica al SANDBOX Docker local. No modifica la clave maestra instalada, no rota M2M, no conecta con Hacienda y no activa emisión. La copia DPAPI instalada y el sobre local independiente están verificados; faltan la copia fuera del equipo y la prueba de recuperación del motor Docker.

## Custodia y dependencia

- Clave original: volumen Docker `spec09_billing_master_key`, archivo `master.key` de 32 bytes, separado de `spec09_billing_secret_store` y `spec09_billing_fiscal_storage`.
- Copia DPAPI v2: `D:\SPEC09-Billing-Master-DPAPI-v2-20261104\master-key.dpapi`, creada bajo `DESKTOP-L6T0PKM\kmena` con `ProtectedData` **CurrentUser**. D: es un disco físico distinto de C:, donde reside Docker. El directorio y sus archivos solo heredan acceso de esa cuenta y `SYSTEM`. `manifest.json` contiene formato, huellas SHA-256 y SID, sin la clave. El marcador de origen (`installed` o `synthetic`) forma parte del contenido DPAPI y no se puede cambiar solo editando el manifiesto. El sobre tiene 262 bytes. SHA-256 del sobre: `92aa6d4e8680d80b46eb7aa8e485b99759b777bd527e309c4730e6e892d7364f`.
- Una primera copia cifrada de formato v1 permanece en `D:\SPEC09-Billing-Master-DPAPI-20261104`. El procedimiento actual exige v2 y no utiliza esa copia. No se borró material de recuperación durante esta preparación.
- La cuenta Windows debe poder iniciar sesión con su **mismo perfil DPAPI**. Conservar el archivo cifrado por sí solo no basta: pérdida del perfil, reinstalación de Windows o traslado a otra computadora pueden impedir el descifrado. No se verificó la recuperación del perfil Windows ni existe una bóveda configurada en Inventori para este fin.
- La segunda vía usa un sobre AES-256-GCM con PBKDF2-HMAC-SHA512 de 1 000 000 iteraciones y una frase aleatoria de al menos 32 caracteres. El marcador de origen va en los datos autenticados de GCM. El sobre se puede verificar sin DPAPI ni el perfil original. El custodio confirmó que creó el registro personal en Bitwarden con 48 caracteres alfanuméricos y volvió a acceder a él. La contraseña se introducirá solo en una terminal local interactiva. No guardarla en Git, Docker, archivos de respaldo, argumentos, variables de entorno, transcripciones o reportes.

## Comandos seguros

Ejecutar en PowerShell 7 desde la raíz de la rama Billing aprobada, con el usuario Windows custodio, sin transcripción de consola. Los destinos deben ser **nuevos**, fuera de Git y de todos los volúmenes Docker. Ningún comando acepta la clave maestra legible como argumento.

```powershell
$dpapiDir = 'D:\SPEC09-Billing-Master-DPAPI-v2-20261104'
& .\scripts\spec09-backup-master-dpapi.ps1 -Mode Verify -Directory $dpapiDir
# Para una copia fresca durante una futura ventana autorizada:
& .\scripts\spec09-backup-master-dpapi.ps1 -Mode Backup -Source Installed -Directory '<directorio-nuevo-fuera-de-Git-en-D>'
& .\scripts\spec09-backup-master-dpapi.ps1 -Mode Verify -Directory '<directorio-nuevo-fuera-de-Git-en-D>'
```

`Backup` comprueba que el volumen tiene el nombre esperado, lo monta de solo lectura en un contenedor sin red, lee la clave en memoria, compara dos lecturas, cifra con DPAPI y comprueba el descifrado antes de escribir. Solo produce el sobre y metadatos seguros. Rechaza un destino existente. `Verify` comprueba SID, huella del sobre, descifrado y huella de la clave sin emitirla. La copia instalada ya superó esas verificaciones y la huella de la clave original seguía igual después.

Antes de crear la segunda copia, el custodio debe crear en su bóveda personal de Bitwarden un elemento de tipo **Inicio de sesión** llamado «Billing SPEC-09 SANDBOX — recuperación». En el campo **Contraseña**, debe generar 48 caracteres aleatorios con mayúsculas, minúsculas y números. Debe guardar el elemento, bloquear la bóveda, volver a abrirla y confirmar que puede acceder a él. Codex no necesita conocer la frase. Registrar después solamente el identificador del elemento, nunca su contenido. No usar la terminal compartida ni este chat para transmitir la frase.

Solo tras esa confirmación, crear la **segunda** copia en otro destino protegido. El script solicita dos veces la frase mediante prompt oculto y comprueba coincidencia; `Verify` la solicita una vez. Pegarla directamente desde Bitwarden en esos prompts locales, sin pasarla como argumento ni variable de entorno.

```powershell
& .\scripts\spec09-create-independent-master-interactive.ps1 -Mode Backup -DpapiDirectory $dpapiDir -Directory 'D:\SPEC09-Billing-Master-Independent-20261104'
# Si la consola se interrumpe después de crear el sobre pero antes de verificarlo:
& .\scripts\spec09-create-independent-master-interactive.ps1 -Mode Verify -Directory 'D:\SPEC09-Billing-Master-Independent-20261104'
```

El ejecutor comprobó que la frase abre el sobre sin consultar DPAPI, rechazó una frase aleatoria incorrecta, exigió ACL restringida y guardó `verification.json` sin secretos. El sobre local quedó en `D:\SPEC09-Billing-Master-Independent-20261104\master-key.independent.json`; solo la cuenta `DESKTOP-L6T0PKM\kmena` y `SYSTEM` tienen acceso. `verification.json` coteja internamente el SHA-256 del **archivo cifrado**, sin exponer la clave ni su huella en el informe. El custodio autorizó `D:` como destino local provisional. **No dispone todavía de la unidad USB externa**: guardar una copia adicional del sobre cifrado fuera del equipo y verificar su integridad sigue pendiente. No guardar la frase junto a ningún sobre. Registrar únicamente custodio, medio, fecha, huella del archivo cifrado y resultado de verificación. Ensayar la lectura desde una copia transportada antes de declarar suficiente el respaldo.

## Conjunto consistente y recuperación

El conjunto de recuperación de una ventana debe contener respaldos coordinados de PostgreSQL Afiliaciones, PostgreSQL Billing, almacén cifrado Billing, artefactos fiscales y clave maestra. Capturar línea base fiscal antes de una pausa controlada de escrituras. El respaldo SQL aislado no recupera certificados, PIN o credenciales. El almacén y los artefactos deben conservar marcadores, referencias y manifiestos; nunca copiar secretos legibles ni la clave original a un laboratorio. Restaurar primero en destinos nuevos; verificar huellas y conteos, resolver referencias y comparar la línea base. No sobrescribir un volumen activo ni arrancar una imagen antigua sobre un esquema migrado sin restauración controlada.

La operación `RestoreToDisposable` de ambos scripts **solo acepta sobres marcados como sintéticos** y un contenedor con etiqueta `spec09-disposable-recovery=true`. Inyecta la clave por stdin en `tmpfs`. No existe un comando que restaure la clave instalada en un volumen activo mediante estos scripts. La recuperación real requiere una ventana y autorización separadas.

## Evidencia y límites

- PASS: copia DPAPI instalada creada en D:, ACL restringida, SHA-256 del sobre verificado, descifrado bajo la cuenta actual y clave original intacta. Línea base fiscal instalada `MATCH`, `changed: []`.
- PASS de laboratorio: prueba E2E Billing con 32 migraciones en PostgreSQL descartable, tres secretos sintéticos, respaldo/restauración del almacén, DPAPI y clave recuperada tras reiniciar el contenedor `tmpfs`; referencias, perfil, actividad y punto de emisión preservados. Una clave incorrecta falló cerrada. No se copiaron secretos reales al ensayo.
- PASS de laboratorio: sobre independiente sintético recuperado después de hacer inaccesible la copia DPAPI de prueba y reiniciar el contenedor descartable. La frase de prueba no se escribió en disco ni se mostró.
- Reproducción de esa prueba: `pwsh -NoProfile -File scripts/test-spec09-master-recovery.ps1` desde la raíz Billing. Genera una clave y frase aleatorias solo para el ensayo, rechaza un manifiesto cuyo origen fue alterado y una frase incorrecta, utiliza un contenedor sin red con `tmpfs`, verifica la huella antes y después de reiniciarlo y elimina los artefactos descartables. Última ejecución: 4 de noviembre de 2026, `SPEC09_SYNTHETIC_INDEPENDENT_RECOVERY_PASS`.
- PASS local: sobre independiente **de la clave instalada** creado y verificado con contraseña introducida por el custodio en consola oculta. Cifrado autenticado AES-256-GCM, PBKDF2-HMAC-SHA512 con un millón de iteraciones, salt y nonce aleatorios, formato v2. Integridad del archivo, correspondencia con la clave DPAPI original, rechazo de contraseña incorrecta, verificación sin DPAPI y ACL restringida: PASS. La copia DPAPI v2 permaneció intacta. Solo hay dos archivos en el destino, ambos cifrado o metadatos seguros; no se escribieron archivos de clave descifrada.
- PASS: línea base fiscal capturada inmediatamente antes y comparada después de crear el sobre: `MATCH`, `changed: []`. La terminal interactiva se cerró tras la operación. No se reiniciaron ni reconstruyeron contenedores habituales.
- PENDIENTE: copiar el sobre cifrado a la unidad USB externa cuando esté disponible, comprobar integridad de la copia y ensayar su recuperación independiente. La contraseña permanece solo bajo custodia del operador en Bitwarden; no se proporcionó el identificador no secreto del registro.
- PENDIENTE: prueba de reinicio del **motor Docker** y restauración integral nueva de la ventana. Solo se reiniciaron contenedores descartables; reiniciar Docker Desktop afectaría los servicios habituales y se reservará para una ventana autorizada.

Estado: `NOT_READY_FOR_3081` hasta cerrar la copia independiente externa y la recuperación del motor Docker con el conjunto íntegro. La copia en `D:` permite verificar el sobre sin DPAPI, pero por sí sola no protege frente a la pérdida de este equipo.
