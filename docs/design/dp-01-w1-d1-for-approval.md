# DP-01 · primer emisor y topología de consumidores — ficha para aprobación

**Estado:** PENDIENTE DE DECISIÓN DEL DUEÑO DEL EMISOR. **Fuente exacta:** fila PENDING de `billing-completion-sdd.md` §5: «Alcance del primer emisor y si Inventori y afiliaciones compartirán una misma `Company` legal en Billing». La propuesta del SDD exige soportar empresa compartida y empresas distintas con asociaciones/credenciales separadas; no identifica el emisor piloto ni acredita que dos aplicaciones representen al mismo obligado tributario.

## Alternativas y regla recomendada

| Opción | Condición verificable | Efecto |
|---|---|---|
| A. Misma `Company` legal | Dueño fiscal confirma que Inventori y el nuevo consumidor emiten para **el mismo** tenant y obligado tributario; la identificación legal coincide con el registro Billing existente y cada ambiente queda declarado | Se conserva la asociación/clave Inventori v1 y se crea una asociación v2 independiente para esa `Company`, sin compartir clave ni operaciones. La secuencia fiscal pertenece al emisor, no al consumidor. |
| B. `Company` separada | Las obligaciones fiscales pertenecen a entes legales diferentes o la identidad no coincide | Cada consumidor usa empresa, asociación, credencial y configuración fiscal propias. Ningún mapeo se infiere del nombre comercial. |
| C. Sin piloto real todavía | No existe evidencia de identidad o autorización de alta | Solo implementación y pruebas sintéticas o descartables; no se crea asociación en la base objetivo. |

**Recomendación:** aprobar A solo con evidencia de identidad legal coincidente; en caso contrario escoger B si ya está confirmada la empresa distinta, o C hasta verificarla. Esta regla no elige por el operador la topología. El primer alta real debe hacerse inicialmente en el ambiente **SANDBOX propuesto** y requiere autorización específica; PRODUCTION no se deduce de ese piloto.

## Datos que debe completar y aprobar el dueño

| Campo | Valor pendiente |
|---|---|
| Opción aprobada | A / B / C |
| Tenant Billing piloto | ID y nombre interno autorizados |
| `Company` legal y número de identificación verificado | ID Billing + evidencia de titularidad (sin copiar datos sensibles en esta acta) |
| ¿Inventori v1 usa exactamente esa `Company`? | Sí / no, con comprobación de asociación existente |
| Nuevo `provider` y `externalConsumerKey` | Identidad estable aprobada para el backend consumidor |
| `externalCompanyKey` estable entre ambientes | Valor/mapeo y dueño de cambios autorizados |
| Ambiente, fecha, operador y responsable de revocación | SANDBOX/PRODUCTION, ventana y responsables |
| Alcance inicial de scopes | Solo readiness y lookup, o excepción explícita documentada |

La confirmación no autoriza alterar `FiscalIntegrationAssociation`, claves Inventori, Hacienda, certificados, secuencias o documentos existentes. La vinculación a una empresa existente exige verificación read-only de tenant, estado, identificación legal y asociación v1; la clave v2 se emite solo mediante el flujo administrativo aprobado y no se copia de Inventori.

## Dependencias y aprobación

El diseño y las pruebas de código genérico con datos sintéticos pueden avanzar tras ADR-BIL-011/012, aunque esta ficha no tenga un emisor elegido. **Crear un vínculo o clave operativa para una empresa real** exige DP-01 completada, preflight DBA de la base objetivo, revisión de seguridad, autorización de datos/ventana y gate de migración separado. Elegir A o B no cambia por sí mismo Prisma; las tablas aditivas de ADR-BIL-011 sí requieren DDL aprobado. Ninguna alternativa habilita emisión fiscal v2 sin ADR-BIL-013 y decisiones tributarias aplicables.

**Aprobación requerida:** dueño del emisor/negocio y responsable de integración para topología e identidad; fiscal confirma identidad legal; seguridad y operación autorizan credencial y ambiente. Registrar responsables, fecha y evidencia de verificación. Hasta entonces, **PENDIENTE**.

| Registro de aprobación | Completar por responsables |
|---|---|
| Resolución | A / B / C, con referencia a la evidencia legal |
| Dueño del emisor y fiscal | Responsables y fecha |
| Integración, seguridad y operación | Responsables, ambiente y ventana autorizados |
