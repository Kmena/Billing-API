# SPEC-10: cierre de regresiones de promoción estable (laboratorio)

## Alcance y controles

Se continuó desde `fb980e824e4608bd6f30c6d5dcaad86023261d2a` en `codex/spec10-one-stag-preparation`. No se contactó Hacienda, no se emitieron documentos, no se usó SMTP real y no se modificaron bases o volúmenes fiscales instalados. Las bases PostgreSQL de Billing y Afiliaciones usadas en las pruebas fueron descartables; la base auxiliar W5 se retiró al terminar.

| Control | Resultado | Evidencia |
| --- | --- | --- |
| `DELIVERY_V2_CONCURRENCY` | PASS en laboratorio | Dos POST HTTP concurrentes obtienen el mismo `deliveryId`; queda una fila de entrega y un PDF. El correo capturado se envía una sola vez y contiene tres adjuntos. El test v2 completo pasó 21/21 en dos corridas aisladas. La unicidad parcial de PostgreSQL y la reclamación `QUEUED → SENDING` del worker permanecen sin cambios. |
| `ENCRYPTED_RECOVERY` | PASS en laboratorio | La restauración sintética pasó dos veces de forma dirigida y dos veces durante las corridas aisladas. Recuperó referencias de certificado, PIN y credenciales, actividades y punto de emisión; comprobó la clave recuperada, rechazó una clave incorrecta y preservó la huella de origen. |
| `FULL_REGRESSION` | NO CONCLUYENTE | Una corrida aislada aprobó 34/34 suites. La repetición con conteo acumulado aprobó las primeras 30 suites y luego falló en 2 de 26 casos NC/ND de Wave 3; los otros 24 pasaron. Ambos casos fallidos pasaron de forma dirigida en bases nuevas. No se declara 34/34 estable con esta última evidencia. |
| Build / typecheck / lint | PASS | `npm run build`, `npm run typecheck`, `npm run lint:check`. |
| Unidades | PASS | 126 suites, 1.402 pruebas aprobadas; 3 suites y 13 pruebas omitidas previamente. Se ejecutaron con acceso a los procesos secundarios Node/Python; la corrida con sandbox restringido había producido `EPERM` ajeno al código. |
| Seguridad estática adicional | FALLA PREEXISTENTE | `npm run test:safety:static` señala `unmanaged-prisma-client` en `test/e2e/wave2/spec09-pgboss-durability.e2e-spec.ts:17`, archivo sin cambios en este trabajo. La comprobación también forma parte de CI y deberá resolverse antes de una promoción estable. |
| `BILLING_MAIN_MERGE` | NO EJECUTADO | El gate integral no quedó estable. `main` era ancestro de la rama y no se modificó. |
| `BILLING_STABLE_TAG` | NO CREADO | `billing-v1.0.0-stable` estaba disponible, pero depende del gate integral. |

## Diagnóstico y correcciones

La prueba de recuperación llamaba `pg_isready` por socket Unix dentro del contenedor de restauración. La imagen PostgreSQL inicia un servidor temporal por ese socket durante su preparación y luego lo detiene antes de arrancar el servidor final. La prueba podía iniciar `pg_restore` contra el servidor temporal y fallar de forma intermitente. Tanto la restauración como el aprovisionador descartable esperan ahora disponibilidad TCP en `127.0.0.1`, que solo corresponde al servidor final. El diagnóstico de fallos Docker expone categorías seguras, sin stderr libre ni secretos.

La entrega v2 ya tenía índice único, PDF único y reclamación atómica del trabajo de correo. Se añadió una aserción HTTP que observa el efecto final con el adaptador de correo capturado: dos solicitudes, un correo y tres adjuntos. El fallo anterior de dos HTTP 500 no se reprodujo al aislar la suite; los datos compartidos y el tiempo de ejecución variable del runner anterior son una explicación probable, no una causa de producto demostrada. `test:e2e:isolated` ejecuta cada suite contra una base y un almacén descartables nuevos para impedir interferencia entre suites. El runner original sigue disponible para pruebas focalizadas.

## Seguimiento desde `da88f6822da666e88adbab3306bce0099004674d` (7 de noviembre de 2026)

La comprobación estática de CI Wave 2 identificaba una instancia directa de `PrismaClient` en la prueba de durabilidad de pg-boss. Se sustituyó por `createGuardedTestPrisma()`, que valida la base descartable y conserva el URL protegido para reiniciar la cola. `npm run test:safety:static` pasó, al igual que la prueba HTTP dirigida, typecheck, build y lint.

La suite NC/ND Wave 3 pasó 26/26 en tres corridas dirigidas sobre bases nuevas y en dos corridas integrales completas. Los dos fallos intermitentes de la corrida anterior no volvieron a ocurrir. No hay evidencia suficiente para atribuirlos a una condición de carrera de producto, al validador XSD o a datos compartidos. Las dos pruebas complejas ahora conservan la exigencia HTTP 201 y emiten solo un código seguro de estado/error si reaparece el problema. El runner aislado muestra la categoría del fallo de aprovisionamiento o proceso sin copiar secretos. No se cambió la lógica ni la expectativa fiscal.

| Control solicitado | Resultado actual | Evidencia |
| --- | --- | --- |
| `NC_ND_REGRESSION` | PASS observado, causa histórica pendiente | Tres corridas Wave 3 dirigidas 26/26; dos corridas integrales 26/26 dentro de 34/34. El fallo histórico no se reprodujo, así que no se afirma causa raíz corregida. |
| `CI_WAVE2_STATIC` | PASS | `TEST_SAFETY_STATIC_CHECK=PASS`; prueba pg-boss dirigida 1/1. |
| `FULL_REGRESSION` | NO REPRODUCIBLE AÚN | Dos corridas integrales 34/34 suites y 236/236 pruebas. Entre ellas, otra corrida se interrumpió en Wave 8 antes de cualquier resumen de Jest; la misma suite pasó dirigida y en ambas corridas completas. La salida antigua del runner no clasificaba esa interrupción. El runner ahora sí la clasifica si reaparece. No se cuentan dos PASS aislados como estabilidad mientras exista este fallo sin diagnóstico. |
| Unidades | PASS | 126 suites y 1.402 pruebas aprobadas; 3 suites y 13 pruebas omitidas ya existentes. |
| Build, typecheck, lint | PASS | `npm run build`, `npm run typecheck`, `npm run lint:check`. |
| M2M v1/v2, entrega v2, recuperación cifrada | PASS en corridas completas | Incluidos en las dos regresiones integrales 34/34; la restauración cifrada y la entrega se ejecutaron sobre PostgreSQL descartable. |
| `BILLING_MAIN_MERGE` | NO EJECUTADO | La interrupción Wave 8 y la causa NC/ND no demostrada impiden afirmar regresión reproducible. `main` permaneció en `b6c454f7d559c8f05eca173482f0ba56d7ba702a`. |
| `BILLING_STABLE_TAG` | NO CREADO | `billing-v1.0.0-stable` sigue disponible; no se asignó a una revisión sin gates cerrados. |

No se contactó Hacienda, no se generaron facturas, no se enviaron correos, no se cambió Inventori ni Afiliaciones y no se modificaron las bases o volúmenes persistentes. La base auxiliar W5 y las bases Billing utilizadas fueron descartables.

## Último gate de promoción (7 de noviembre de 2026)

Desde `544e4c1434731cefdfa6a903a01a8ad13c914f15`, Wave 8 se ejecutó sola con PostgreSQL descartable, el cliente HTTP real de Inventori y captura de métricas en memoria. Salida 0; 32,86 s de pared; 1.054,73 MiB de pico en la suma de los procesos Node nuevos (no incluye PostgreSQL); timeout de 300 s no alcanzado; Jest 1/1 en 23,034 s. No hubo interrupción que diagnosticar en esa ejecución.

La regresión integral posterior pasó 34/34 suites y 236/236 pruebas, incluida Wave 8 1/1, NC/ND 26/26, contratos M2M, entrega v2 y recuperación cifrada. `npm run test:safety:static` devolvió `TEST_SAFETY_STATIC_CHECK=PASS`; build, typecheck y lint pasaron. Estas pruebas se ejecutaron con bases Billing aisladas por suite y una base auxiliar Afiliaciones de 20 migraciones en `tmpfs`, retirada al concluir. No se contactó Hacienda ni se usó SMTP real.

La interrupción de Wave 8 de la corrida anterior ocurrió antes de un resumen de Jest y su causa histórica no puede afirmarse con la salida disponible. La suite pasó dirigida y dentro de la regresión integral de este gate. El runner conserva el diagnóstico categórico agregado para una futura interrupción; no se relajaron expectativas ni se modificó código fiscal.

Antes de la promoción, `origin/main` estaba en `fb64aa1ff31135b86985beeb95457350f3942815` y el `main` local en `b6c454f7d559c8f05eca173482f0ba56d7ba702a`. El único commit remoto no presente en la candidata era el merge `fb64aa1`; su árbol no introducía archivos distintos del ancestro común `cd1ad1da90db20f4cf3f4295b2546df619c9dcab`. Su historia debe integrarse sin modificar el árbol probado. El tag `billing-v1.0.0-stable` estaba libre. La promoción se registra después en Git por sus SHA finales.

## Reproducción segura

1. Preparar la base W5 de Afiliaciones en PostgreSQL 16 descartable y configurar `AFILIACIONES_W5_ROOT`, `W5_TEST_DATABASE_URL` e `INVENTORI_BILLING_CLIENT_PATH` hacia copias de laboratorio. No apuntar a instalaciones persistentes.
2. Ejecutar `npm run test:e2e:isolated` desde este commit. El runner verifica el resumen de Jest de cada suite y al final imprime suites y casos aprobados.
3. Ejecutar `npm test -- --runInBand --silent`, `npm run typecheck`, `npm run build` y `npm run lint:check` con permiso para lanzar los validadores locales Node y Python.

No se realizó merge, tag, push ni despliegue.
