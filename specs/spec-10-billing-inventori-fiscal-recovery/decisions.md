# Decisiones y preguntas abiertas

## Decidido por evidencia

1. Billing es responsable de XML, firma, OAuth, recepción, conciliación, artefactos y entrega. Inventori/Afiliaciones son consumidores; no se crea otro adaptador Hacienda en ellos.
2. La aceptación F4-S fue real y **posterior al GET**. El POST 202 por sí mismo no aceptó fiscalmente el documento.
3. El primer 403 SPEC-09 ocurrió con un host/ruta diferente del F4-S observado. `33df203` reconcilió el endpoint instalado, pero la factura actual sigue en revisión manual; no hay prueba de recepción nueva.
4. La contraseña administrativa del reenvío `f517eed` no era parte del flujo ordinario. No se requerirá para emisión normal. Una acción excepcional seguirá necesitando identidad administrativa verificable y auditoría, con mecanismo de recuperación definido.
5. Dos instalaciones Billing conservan sus bases y almacenes propios. Una arquitectura objetivo de “un Billing” no autoriza fusionarlos por copia directa.

## Decisiones críticas pendientes

| ID | Decisión / evidencia necesaria | Responsable propuesto |
| --- | --- | --- |
| D1 | Qué instancia será autoridad para **nueva** emisión de cada empresa y desde qué instante; inventario de emisores, secuencias, documentos y estados en ambas bases. | Operador fiscal + arquitectura |
| D2 | Cómo preservar acceso a documentos históricos si se retira Billing histórico; mapeo sin colisión de IDs y artefactos. | Arquitectura + datos |
| D3 | Estrategia de migración o convivencia de almacenes cifrados y claves de recuperación, con ensayo de restore. | Seguridad + operación |
| D4 | Contrato unificado: mantener v1 y v2 como fachadas permanentes o migrar Inventori a v2 tras paridad; scopes concretos y rollout. | Equipos consumidores + Billing |
| D5 | Mecanismo humano para excepciones fiscales cuando no existe contraseña de administrador Billing disponible; identidad existente, aprobación, recuperación y auditoría. | Seguridad + operador |
| D6 | Prueba continua real de entrega sintética y cierre de tareas PDF tardías; verificación del SHA de código de la imagen histórica. | QA + release |

Estas decisiones bloquean `SPEC10_READY_FOR_IMPLEMENTATION`. Ninguna permite reintentar o cambiar la factura SPEC-09 dentro de SPEC-10.
