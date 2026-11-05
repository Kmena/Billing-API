# SPEC-09: correo seguro y reconciliación de Billing antes de la primera FE STAG

Estado: **PREPARADO EN CÓDIGO; NO INSTALADO; SIN ENVÍO FISCAL**.

## Estado observado

- Billing SPEC-09 instalado: imagen `billing-spec09-sandbox:payment-evidence-612f654`, base `spec09-billing-postgres-1`, sano. La emisión STAG y el correo real están apagados.
- Billing original de Inventori: `billing-api`, `billing-worker`, `billing-postgres`. Inventori usa ese Billing; `inventori-api` estaba `unhealthy` en el último inventario. Ningún contenedor original fue modificado.
- El remitente confirmado contra la configuración privada anterior es `billing.facturascr@gmail.com`. La contraseña de aplicación se migró mediante entrada local al almacén cifrado de Billing; su valor no se muestra en esta evidencia.
- Gmail requiere TLS para SMTP y admite `smtp.gmail.com:587` con STARTTLS; la contraseña de aplicación se introduce directamente en una terminal interactiva.

## Cambio preparado

- `EMAIL_USE_REAL=true` resuelve `SMTP_AUTH` desde el `SecretProvider` duradero. El registro contiene usuario y contraseña en una sola escritura cifrada. No se aceptan `SMTP_USER` ni `SMTP_PASSWORD` desde el entorno.
- El adaptador exige TLS en el puerto SMTP sin TLS implícito. La excepción de prueba solo existe al construir directamente el adaptador para el servidor sintético local; la fábrica de la aplicación no la utiliza.
- `node dist/src/cli/put-smtp-auth.js --confirm-create-or-identical` solicita usuario y contraseña con entrada oculta, crea o verifica el registro y rechaza sobrescribir otro valor. No toma secretos por argumentos ni por variables de entorno.
- El correo real sigue desactivado hasta que haya respaldo y restauración verificados del almacén cifrado, prueba de autenticación SMTP sin entrega y una candidata compatible instalada.

## Bloqueo para un único Billing

Las dos bases persistentes tienen historiales distintos. La original tiene 25 migraciones aplicadas y la SPEC-09 tiene 32. Hay 19 nombres compartidos con checksums diferentes; la original tiene una migración aplicada ausente del historial SPEC-09. La base original conserva documentos, entregas, certificados y claves de Inventori que no están en la base SPEC-09. Cambiar la URL de Inventori a la base SPEC-09 o ejecutar `migrate deploy` sobre la base original no preserva esos registros de forma demostrada.

Antes de consolidar: comparar SQL y esquemas de las migraciones divergentes; respaldar y restaurar ambas bases y sus almacenes; preparar una reconciliación de datos históricos, claves de consumidor y emisores sin reescribir migraciones ya aplicadas; verificar Inventori v1 en entorno descartable. No apuntar Inventori al Billing SPEC-09 hasta que esa prueba pase. No modificar `inventori-api` en su estado `unhealthy` sin diagnóstico independiente.

## Secuencia controlada para la única factura autorizada

1. Confirmar que la obligación `4171d591-d0ae-4a0b-8c55-e2a36c8219de` aún no tiene pago ni intención fiscal y que la cuenta bancaria ficticia sigue activa.
2. Crear y restaurar respaldos nuevos de Afiliaciones y Billing, incluidos almacén cifrado y claves de recuperación; registrar huellas fiscales sin exponer valores.
3. Validar la candidata Billing en entorno descartable. Instalarla en la instancia SPEC-09 existente solo después de comprobar compatibilidad, salud y conservación; no tocar la instancia original.
4. Verificar `SMTP_AUTH` en el almacén cifrado y autenticar por SMTP sin enviar correo. Configurar `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_SECURE=false`, `EMAIL_FROM_ADDRESS=billing.facturascr@gmail.com` y `EMAIL_USE_REAL=true` únicamente cuando corresponda habilitar la entrega. No usar SMTP de producción fiscal.
5. Habilitar solo el destino Hacienda STAG y el cliente/obligación autorizados. Mantener producción bloqueada. Validar XML, firma, receptor y política fiscal del plan antes de aprobar.
6. Registrar un único pago SINPE con referencia y evidencia sintéticos; verificar rechazo de autoaprobación y aprobarlo con el segundo usuario. Comprobar intención única e idempotencia.
7. Seguir el documento por identificador: XML firmado, aceptación o rechazo explícito de Hacienda STAG, PDF y entregas a `kmena281@gmail.com`. Un fallo o resultado SMTP incierto requiere conciliación, no reenvío ciego.
8. Comparar huellas, saldos, auditoría y conteos; no reintentar la emisión con otro identificador.

La autorización del operador comprende una única prueba STAG con datos de pago sintéticos. **Todavía no se ejecutaron los pasos 2–8 ni se contactó Hacienda o Gmail desde Billing.** La consolidación de Inventori requiere resolver el bloqueo de migraciones por separado.

## Evidencia de la candidata de correo

- 31 pruebas focalizadas: PASS (fábrica, validación de configuración y SMTP sintético local).
- Typecheck sin escritura de cache: PASS.
- ESLint de archivos modificados: PASS. El lint global conserva dos errores de formato preexistentes en `w2-b-lab-projection.spec.ts`.
- Compilación de producción dirigida a directorio temporal: PASS.
