# W4-B-R3 — idempotencia, concurrencia y recuperación

Las solicitudes simultáneas corrieron por HTTP real contra PostgreSQL descartable. El motor de R2 usa claves persistidas, restricciones únicas y transacciones de base; R3 aporta evidencia del comportamiento. No se añadió mutex de proceso.

| Caso | Resultado observado |
|---|---|
| Misma clave y payload después de commit | 201 con ID original; un documento y consecutivo estable |
| Misma clave, payload distinto | 409, sin documento adicional |
| Otra clave, segunda NC total del mismo original | 409; solo una NC, una asignación de secuencia |
| Dos claves simultáneas, misma NC | 201/409; solo una NC |
| Dos ND simultáneas, claves distintas | 201/201; consecutivos distintos |
| Dos POST simultáneos con la misma clave | Respuestas 201 o 409; GET por clave recupera una sola identidad |
| POST interrumpido por pausa del PostgreSQL de laboratorio | Reintento y GET por clave recuperan una sola ND |
| Reserva `IN_PROGRESS` sin documento | GET 409 `IDEMPOTENCY_REQUEST_IN_PROGRESS`; no fabrica documento |
| Reinicio de la API | GET por clave devuelve el mismo ID y clave fiscal |
| Desconexión temporal de PostgreSQL | GET falla/expira durante la pausa; después recupera el mismo ID |
| Fallo de firma o XSD | Reintento de preparación conserva documento e identidad |

La pausa se aplicó solo tras comprobar la etiqueta y el identificador de la ejecución del contenedor descartable; se reanudó en `finally`. En el POST interrumpido, el punto exacto de commit depende del planificador y no se fijó de forma determinista. Se cubrieron el replay de un commit ya confirmado y la recuperación de una respuesta interrumpida. La suite comprueba conteos y consecutivos para los casos de colisión. Un estado incierto continúa como 409 hasta consulta o reintento; no se altera automáticamente.

**Idempotencia y concurrencia: PASS_LAB. Resiliencia: PASS_LAB para los fallos observados; el punto de commit exacto sigue como riesgo residual.**
