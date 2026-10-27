# Billing W1-D1 · fase sin DDL · evidencia técnica

**Fecha:** 2026-10-27. **Base:** `codex/billing-w1-design` / `b8764bb`. **Alcance:** criterios ADR-BIL-011/012 autorizados para diseño y pruebas aisladas. Los ADR siguen **PENDIENTES DE APROBACIÓN FORMAL**; DP-01 también sigue pendiente. No hay rutas v2 operativas, credenciales emitidas, asociaciones reales, reservas persistentes, DDL, merge ni despliegue.

## Trazabilidad T03–T05

| Requisito | Entregado en esta fase | Límite y dependencia |
|---|---|---|
| T03 identidad/asociación | DTO v2 de asociación y clave; política pura de identidad, tenant, empresa, ambiente, perfil y scopes; rotación/revocación y proyección segura de auditoría; fixture sintético actualizado | No hay emisor vinculado ni servicio de alta. Cuatro tablas aditivas, índices/FKs y revisión DBA antes de persistir. |
| T04 idempotencia | Namespace asociación/ambiente/operación/clave; lookup con hash y versión obligatorios, 404 uniforme, replay `SAME/CONFLICT`, estados e integridad probados sin escritor | Tabla de reserva, unicidad y transacciones pendientes. Hash fiscal canónico, retención y emisión requieren ADR-BIL-013/017 y decisiones fiscales futuras. Reservas v1 intactas. |
| T05 autorización | Clave de perfil v2 rechazada por guard v1 y por asignación N:M legada; política pura de aislamiento, scopes, suspensión y ambiente; negativos y contrato propuesto | Guard v2, controles de origen en documentos/artefactos y auditoría transaccional requieren persistencia; ninguna ruta v2 está registrada. |

## Matriz de pruebas

| Gate | Evidencia y comando | Resultado |
|---|---|---|
| Políticas y DTO | `npm test -- --runInBand --silent`; prueba focalizada posterior del último ajuste | Regresión completa: 117 suites aprobadas, 3 omitidas; **1.336 aprobadas, 13 omitidas, 0 fallidas**. Ajuste posterior de revocación/integridad: 5 suites, **45/45** focalizadas. |
| Contratos v2 y v1 | `npm run test:w1:d0` | 5 suites, **31/31**; incluye OpenAPI v2, fixture y contratos v1. |
| Lock Inventori | Suite `inventori-v1-all-routes-contract.spec.ts` en regresión unitaria | PASS: 42 pares método/ruta y snapshot de guardas/scopes. |
| Seguridad estática | `npm run test:safety:static` | PASS. |
| Seguridad | `npm run test:safety` | 3 suites, **35/35**. |
| E2E Inventori | `npm run test:e2e:disposable` con `INVENTORI_BILLING_CLIENT_PATH` del cliente fijado | 26 suites, **153/153**, 0 fallidas en PostgreSQL descartable. |
| Compilación y tipos | `npm run build`; `npm run typecheck` | PASS después del ajuste final de política. |
| Lint | `npm run lint:check` | PASS: 0 errores, 26 warnings preexistentes `no-explicit-any`; cero en archivos W1-D1. |

El cliente Inventori fijado es `edb1e05186d296e3699c71306913f16aee470d1e:inventory-api/src/services/billing-api-client.service.js`, SHA-256 `1bc069fa657569ce3c489b633775adea8ba362bbe3c3f19e0051209c88ea9da0`. La copia temporal fue verificada antes del E2E. El harness E2E utiliza PostgreSQL descartable etiquetado y aplica solo las 24 migraciones históricas para ese contenedor.

### Reproducción

```powershell
npm run test:w1:d0
npm test -- --runInBand --silent
npm run test:safety:static
npm run test:safety
npm run typecheck
npm run build
npm run lint:check
# Con el cliente Inventori fijado en una copia temporal verificada:
$env:INVENTORI_BILLING_CLIENT_PATH = '<ruta al cliente fijado>'
npm run test:e2e:disposable
```

## Dependencias DDL y gates posteriores

1. **T03:** `FiscalConsumer`, `FiscalConsumerCompany`, `FiscalConsumerAssociation` y `FiscalConsumerKeyBinding`, con unicidad y FKs tenant/empresa/ambiente, tal como propone ADR-BIL-011. Las credenciales v2 usarían el hash Argon2id de `ApiKey`, con binding inmutable y auditoría en la misma transacción. El servicio emisor de claves debe validar expiración, subconjunto de scopes y ventana de rotación; la referencia de 90 días no es una expiración automática. Seguridad aún debe aprobar vida máxima y solapamiento.
2. **T04:** `FiscalIdempotencyKeyV2` aditiva, índice único `(associationId,environment,operation,key)`, restricciones de estado/documento y transición concurrente. No tocar `FiscalIdempotencyKey` ni su índice v1. No hay cálculo fiscal canónico ni reserva operativa en esta fase.
3. **T05:** antes de leer o emitir documentos v2, atribución de origen (`originConsumerId` o equivalente aprobado) y filtros por asociación en lectura por ID, XML, artefactos, notas y feed. El guard v2 deberá cargar registros confiables y usar la política pura; ninguna clave v1 se reutiliza.
4. **DBA:** comprobar en solo lectura la base objetivo, revisar 16 divergencias W0 y el plan de migración aditiva; no hay conexión autorizada a esa base en este worktree. Ensayar SQL únicamente en DB descartable después de aprobación de ADR/DDL. DP-01 y validación de identidad legal son previas a cualquier vínculo real.

## Riesgos residuales

- El bloqueo de perfil v2 en el guard v1 protege el caso de clave nueva con ese perfil. El guard v2 y su consulta de binding siguen pendientes; las pruebas puras no equivalen a autorización HTTP operativa.
- La política de rotación decide si puede emitirse una segunda clave, pero un futuro servicio deberá imponer atómicamente el límite y revocar la anterior al terminar la ventana; duración máxima de solapamiento y vida de clave siguen pendientes de Seguridad.
- La revocación y la auditoría son decisiones puras/puertos, sin escritura. Revocación inmediata en todas las réplicas, filtrado de logs y auditoría transaccional deberán probarse con el servicio persistente.
- El lookup compara evidencia hash con valor almacenado; Billing deberá calcular su propio hash canónico versionado al crear. No hay decisión fiscal para ese hash en W1-D1.
- El esquema efectivo de la base objetivo y las 16 divergencias siguen sin observarse en lectura DBA. STAG y producción no están validados.

**Estado: `W1_D1_NO_DDL_TECHNICAL_PASS`.** Los criterios aplicables a políticas/DTO, contratos, seguridad, v1 y E2E descartable pasaron. Este cierre técnico se limita a la fase sin DDL y no constituye aprobación formal de ADR-BIL-011/012 ni DP-01. No acredita W1-D1 persistente, STAG ni producción.
