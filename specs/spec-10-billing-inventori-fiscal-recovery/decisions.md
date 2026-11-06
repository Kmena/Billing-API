# Decisiones y preguntas abiertas

## Decidido por evidencia

1. Billing es responsable de XML, firma, OAuth, recepción, conciliación, artefactos y entrega. Inventori/Afiliaciones son consumidores; no se crea otro adaptador Hacienda en ellos.
2. La aceptación F4-S fue real y **posterior al GET**. El POST 202 por sí mismo no aceptó fiscalmente el documento.
3. El primer 403 SPEC-09 ocurrió con un host/ruta diferente del F4-S observado. `33df203` reconcilió el endpoint instalado, pero la factura actual sigue en revisión manual; no hay prueba de recepción nueva.
4. La contraseña administrativa del reenvío `f517eed` no era parte del flujo ordinario. No se requerirá para emisión normal. Una acción excepcional seguirá necesitando identidad administrativa verificable y auditoría, con mecanismo de recuperación definido.
5. Dos instalaciones Billing conservan sus bases y almacenes propios. Una arquitectura objetivo de “un Billing” no autoriza fusionarlos por copia directa.
6. El código SPEC-09 es la base objetivo de la futura autoridad única. Se propone también su base física para **nueva emisión**, sujeta a conciliación; el histórico conserva lectura. La coincidencia de la única identidad fiscal de pruebas es esperada. Los 24 SQL compartidos son iguales tras normalizar CRLF; los checksums aplicados siguen siendo parte de cada ledger y no se alteran.
7. Los recorridos simulados actuales pasan desde Inventori hasta PDF/XML/respuesta y desde Afiliaciones hasta entrega de respuesta. La ruta v2 aún no produce PDF/paquete completo en ese recorrido. Son pruebas locales, no aceptación STAG.

## Decisiones críticas pendientes

| ID | Decisión / evidencia necesaria | Responsable propuesto |
| --- | --- | --- |
| D1 | El código SPEC-09 será objetivo; falta decidir **base física**, instante de corte y contador único. Hoy el histórico tiene `next_value=8` y SPEC-09 `next_value=2` para el mismo emisor/punto/tipo; no hay colisión actual. | Operador fiscal + arquitectura |
| D2 | Cómo preservar acceso a documentos históricos si se retira Billing histórico; mapeo sin colisión de IDs y artefactos. | Arquitectura + datos |
| D3 | Estrategia de migración o convivencia de almacenes cifrados y claves de recuperación, con ensayo de restore. | Seguridad + operación |
| D4 | Contrato unificado: mantener v1 y v2 como fachadas permanentes o migrar Inventori a v2 tras paridad; scopes concretos y rollout. | Equipos consumidores + Billing |
| D5 | Mecanismo humano para excepciones fiscales cuando no existe contraseña de administrador Billing disponible; identidad existente, aprobación, recuperación y auditoría. | Seguridad + operador |
| D6 | Completar PDF/XML/respuesta en **el mismo** recorrido Afiliaciones v2, cerrar tareas PDF tardías y verificar el SHA de código de la imagen histórica. Inventori v1 ya pasó su recorrido local completo. | QA + release |
| D7 | La migración histórica `20261103000000_fix_idempotency_api_key_rotation` está aplicada y el índice final coincide; sus bytes SQL siguen sin recuperarse. Conservar el ledger y ensayar la estrategia de datos en restauraciones. | DBA |
| D8 | Resolver DF-06/ADR-BIL-014/016 para notas, referencias mixtas, exoneración y vigencia XSD antes de declarar esos escenarios fiscales funcionales. | Responsable tributario |

Estas decisiones bloquean `SPEC10_READY_FOR_IMPLEMENTATION`. Ninguna permite reintentar o cambiar la factura SPEC-09 dentro de SPEC-10.
