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

## Bloqueo residual

La segunda corrida aislada tardó más de cinco minutos en Wave 3 y falló en dos escenarios de NC/ND que habían pasado en la primera corrida. Cada escenario volvió a pasar individualmente. La causa de esa variación no está demostrada. Conforme a la decisión del usuario, se difiere su investigación a la integración de NC/ND con Afiliaciones. La comprobación estática preexistente también requiere cierre antes de una promoción. No se cambia la lógica fiscal de NC/ND ni se promueve una versión estable con gates pendientes.

## Reproducción segura

1. Preparar la base W5 de Afiliaciones en PostgreSQL 16 descartable y configurar `AFILIACIONES_W5_ROOT`, `W5_TEST_DATABASE_URL` e `INVENTORI_BILLING_CLIENT_PATH` hacia copias de laboratorio. No apuntar a instalaciones persistentes.
2. Ejecutar `npm run test:e2e:isolated` desde este commit. El runner verifica el resumen de Jest de cada suite y al final imprime suites y casos aprobados.
3. Ejecutar `npm test -- --runInBand --silent`, `npm run typecheck`, `npm run build` y `npm run lint:check` con permiso para lanzar los validadores locales Node y Python.

No se realizó merge, tag, push ni despliegue.
