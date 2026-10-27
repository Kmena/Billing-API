# Preparación verificable para producción

**Dictamen al 27 de octubre de 2026: NO GO para el alcance completo de afiliaciones.** Hay FE gravada histórica aceptada en STAG; las notas fiscales y varios escenarios requeridos no existen. El informe operativo `docs/operations/wave2-security-release-candidate.md` declara autorización de producción bloqueada. No se ha desplegado ni transmitido nada en esta auditoría.

Leyenda: `PASS LOCAL` = verificación reproducible sobre código/infraestructura aislada; `PASS STAG` = respuesta oficial en ambiente de pruebas y para el tipo/escenario exacto; `PROD AUTH` = habilitación y aprobación del emisor/operadores para artefacto, ambiente y fecha exactos. `PENDING` no equivale a fallo fiscal observado. Marcar cada casilla solo con enlace a resultado, commit, fecha y responsable.

## Gates técnicos y fiscales

| Gate | Evidencia exigida | Estado actual |
|---|---|---|
| Fuente inmutable | commit limpio, hash de árbol, lockfile, SBOM, imagen API/worker idéntica y XSD vigente | PENDING: árbol local sucio; informe de candidato anterior no identifica este árbol |
| Normativa y emisor | regla firmada de hecho generador, CABYS, exención/IVA y REP por concepto; registro del emisor y actividades | PENDING: alcance nuevo sin decisión por emisor |
| Anexos v4.4 actualizados | obtener paquete oficial, comparar XSD y códigos de referencia 2026, pruebas de regresión | PENDING: dos XSD locales FE/TE; actualización oficial anuncia nuevos códigos al 1/11/2026 |
| Tipos de documento del alcance | FE, TE si aplica, NC total/parcial, ND, REP/FEE si aplica, XML/PDF/respuesta | BLOCKED: NC/ND/REP/FEE ausentes |
| Integridad de líneas | concepto, período, CABYS, base, descuento, impuesto, monto aplicado; suma contra ledger | PENDING: contrato afiliaciones y pruebas cruzadas ausentes |
| Idempotencia y recuperación | timeout antes/después de POST, clave/índice, lookup, reinicio y no doble emisión | PASS LOCAL parcial: código/pruebas; PENDING para productor nuevo y entorno objetivo |
| M2M y aislamiento | clave por empresa/ambiente/aplicación, scopes, rotación/revocación, negativos cruzados | PENDING: perfil nuevo y E2E cruzado faltan |
| Secretos/certificados | custodia, rotación, identidad y vencimiento, prueba de no fuga | PASS LOCAL en componentes; PENDING para custodia/operación del nuevo emisor |
| Suite de código | tipos, lint, unidad, E2E DB descartable, contratos, seguridad, XSD | Tipos PASS local con `--incremental false`; suite unidad **FAIL** en este corte; E2E no ejecutado |
| Hacienda STAG | OAuth, POST, GET/callback, XML firmado, aceptación/rechazo y respuesta archivada **por tipo y escenario** | PASS STAG histórico solo FE gravada; TE/exento/notas/REP PENDING |
| Envío y recuperación documental | XML firmado, respuesta Hacienda, PDF, correo, reenvío y hashes restaurados | PASS LOCAL parcial; SMTP y restore del destino PENDING |
| Cola/observabilidad | worker único, trabajos vencidos, alertas por atasco/rechazo/SMTP, auditoría | Código/E2E mock disponibles; métricas y alertas productivas PENDING |
| Backups/continuidad | DB, objetos, almacén cifrado, clave separada, restauración y RPO/RTO acordados | Procedimientos y ensayos locales históricos; destino productivo PENDING |
| Migraciones | lista exacta aplicada/pendiente, checksums, ensayo en restore, rollback compatible | BLOCKED: divergencia de procedencia documentada y migraciones `202611*` posteriores a este corte |
| Seguridad de dependencias | auditoría del runtime real, excepciones con justificación, escaneo de imagen y secretos | Candidato histórico con riesgo compensado; repetir sobre imagen exacta |
| Producción | credenciales/certificado productivos del emisor, permisos, aprobaciones negocio/fiscal/seguridad/DB, ventana y rollback | **PROD AUTH BLOCKED**; sin evidencia de habilitación/aceptación real productiva |

## Pruebas mínimas de salida

1. **Contrato consumidor:** los 16 escenarios de [integración](billing-affiliations-integration.md) con snapshots de línea y balance entre pago, obligación y comprobante; matriz de rechazo, timeout y reintento. Acreditar explícitamente los casos no aplicables por política fiscal.
2. **Fiscal local:** cada tipo aplicable valida el XSD oficial actualizado, firma, verificación, monto y resumen; PDFs comparados visualmente con XML y respuesta. Los importes cero tienen tratamiento declarado. Probar NC/ND parcial, múltiples notas y concurrencia.
3. **STAG:** recepción y aceptación oficiales para FE gravada y exenta, TE, NC/ND y REP/FEE cuando aplique; un rechazo controlado; evidencia de `clave`, hash XML, status final y respuesta. Un HTTP 201/202 solo indica recepción, no aceptación.
4. **Continuidad:** pérdida de respuesta POST, partición DB/Hacienda, reinicio API/worker, cola detenida, SMTP de resultado incierto, caducidad de token/certificado, restauración de DB y artefactos. Verificar ausencia de doble consecutivo y conservación de documentos.
5. **Seguridad:** tenant/empresa/ambiente/key/scopes cruzados, JWT admin, uploads, secretos en logs, enlaces de descarga, callback Hacienda, webhooks salientes si se implementan, rate limits y revisión de dependencias de imagen.
6. **Operación:** monitoreo de pendientes, `MANUAL_REVIEW_REQUIRED`, rechazo, fallas de entrega y capacidad del operador para reconciliar/reenviar sin modificar un documento aceptado.

## Evidencia y autorización

Crear un registro de liberación por emisor/ambiente que contenga: imagen por digest, migraciones/checksums, versión normativa y XSD, resultados de CI, reporte STAG sanitizado, configuración de secretos sin valores, prueba de backup/restore, RPO/RTO, plan de contingencia, contactos de incidente, ventana de activación y firmas de dueño de negocio, responsable tributario, seguridad y DBA/operaciones. La autorización del emisor ante Hacienda y la autorización interna de despliegue son hechos distintos. Ni una aprobación interna ni un `readyToIssue=true` acreditan aceptación fiscal de una operación concreta.

## Estado de esta auditoría

`npx tsc --noEmit --incremental false` pasó. `npm run typecheck` intentó escribir `dist/tsconfig.tsbuildinfo` y recibió `EPERM`; el rerun sin incremental aisló el problema de escritura. `npm test -- --runInBand --silent` terminó con **106 suites aprobadas, 7 fallidas, 3 omitidas; 1.264 pruebas aprobadas, 43 fallidas, 13 omitidas**. Seis suites fallaron en rutas que usan el adaptador XSD: `node` recibió `spawnSync python EPERM`, mientras la compilación directa de XSD FE por Python devolvió `valid:true`. La séptima falló en 8 pruebas de PDF por `EPERM` al escribir en `test-output/pdf` (29 de esa suite pasaron). Son límites de ejecución locales identificados, no evidencia de rechazo de Hacienda; hay que repetir la suite en CI o entorno apto. No hubo prueba E2E, STAG ni producción en este corte. Este resultado impide declarar la suite local global como PASS.
