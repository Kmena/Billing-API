# SPEC-09 — Reutilización de la ruta STAG probada con Inventori

Fecha: 5 de noviembre de 2026. Investigación y corrección **solo en rama aislada** `codex/billing-spec09-stag-endpoint-reconcile`. Inventori, Docker, bases persistentes, secretos y factura existente no se modificaron. No se contactó Hacienda durante este trabajo.

## Arquitectura encontrada

Inventori no implementa el transporte de comprobantes a Hacienda. Su `BillingApiClient` llama a Billing v1 con `X-API-Key`, clave de idempotencia y correlación; Billing conserva la emisión, firma, envío y reconciliación. La consulta tributaria `/fe/ae` de Inventori es otra integración y no prueba recepción de comprobantes. Las pruebas de Inventori distinguen `ACKNOWLEDGED`/HTTP 201 de `ACCEPTED`: un acuse de transporte no es aceptación fiscal.

La prueba histórica F4-S que acompañó a la integración con Inventori ejerció el **mismo `HaciendaRecepcionAdapter` de Billing** con la ruta dedicada `https://api-sandbox.comprobanteselectronicos.go.cr/recepcion/v1`. El informe `C:\Users\kmena\Documents\proyectos\Billing\specs\fase-4-s-hacienda-sandbox-validation\implementation-report.md` documenta: token STAG HTTP 200; POST `/recepcion` HTTP **202**; estado local `POST_OUTCOME_UNKNOWN`; GET `/recepcion/{clave}` HTTP 200 con `ind-estado=aceptado` y `Mensaje=1`; estado final `ACCEPTED`. No hay un HTTP 201 observado en esa ejecución. La evidencia sanitizada local `C:\Users\kmena\Documents\proyectos\Billing\test-output\hacienda-sandbox\TASK-009-STATUS\task-009-status-1790122709729.json` (SHA-256 `b33ab0d6c257d53e6b1cd938ee28461645acf11fe5db2fc6e0c5574700c9dd13`) confirma los campos de estado sin token ni secreto. El repositorio Inventori contiene tests de contrato y reconciliación, no otra prueba directa de aceptación fiscal.

## Comparación técnica

| Dimensión | F4-S con Inventori | SPEC-09 instalado | Hallazgo |
| --- | --- | --- | --- |
| Receptor HTTP | `api-sandbox.comprobanteselectronicos.go.cr/recepcion/v1` | `api.comprobanteselectronicos.go.cr/recepcion-sandbox/v1/` | **Diferencia crítica de host y ruta.** La primera tuvo aceptación histórica; la segunda dio 403 en POST y GET. |
| URL final de POST | Base + `/recepcion` | Base + `/recepcion` | Mismo constructor en `HaciendaRecepcionAdapter`. |
| URL final de GET | Base + `/recepcion/{clave}` | Base + `/recepcion/{clave}` | Mismo componente de reconciliación. |
| OAuth | IDP `rut-stag`, `client_id=api-stag`, password grant | Igual; token HTTP 200 en el diagnóstico previo | Autenticación válida, autorización de recepción no demostrada. No se conserva una prueba del valor `aud` del token histórico. |
| Encabezado | `Authorization: bearer <token>`; JSON UTF-8 | Igual | No se identificó diferencia de encabezados que explique el 403. |
| Cuerpo | Clave, fecha, emisor, XML firmado en Base64 y receptor opcional | Mismo adaptador; prueba local de contrato | El 403 ocurrió en el analizador de autorización del gateway, antes de respuesta fiscal de contenido. |
| Firma/certificado | XAdES-EPES, identidad emisor/certificado coincidente, XSD v4.4 | XML actual firmado y huella de archivo verificada | Custodia actual es el almacén cifrado de Billing; no se copia material de Inventori. |
| Respuestas | HTTP 202 se dejó ambiguo; GET `aceptado` fijó aceptación | POST 403, GET 403 `IncompleteSignatureException` | La factura SPEC-09 sigue en revisión manual, sin aceptación ni rechazo confirmado. |
| Proxy | Sin proxy explícito en cliente Inventori ni adaptador F4-S | Sin variable de proxy en contenedor Billing | La topología histórica de red no está documentada completamente. |

El análisis `C:\Users\kmena\Documents\proyectos\Billing\specs\fase-4-s-hacienda-sandbox-validation\official-contract-findings.md` distingue la URL de SANDBOX publicada en documentación (`api.comprobanteselectronicos.go.cr/recepcion-sandbox/v1/`) de la ruta mostrada entonces en Tico Factura y **observada funcionando** (`api-sandbox.comprobanteselectronicos.go.cr/recepcion/v1`). El guard F4-S rechaza explícitamente la URL publicada antigua en el host compartido con producción. SPEC-09 configuró precisamente esa URL antigua como valor predeterminado y como único valor permitido por su guard local. La configuración privada instalada también la fijó explícitamente; por tanto cambiar solo el predeterminado no bastaría en una instalación futura.

**Causa probable del 403:** Billing SPEC-09 dirigió recepción y consulta al host/ruta antigua. El error `IncompleteSignatureException` confirma que esa ruta interpretó Bearer como AWS SigV4. La diferencia de endpoint explica técnicamente el rechazo. La ruta dedicada tuvo aceptación real en septiembre de 2026, pero no se probó contra Hacienda en este diagnóstico; su disponibilidad **actual** y el estado externo de la factura SPEC-09 siguen sin confirmar. No se afirma reparación operativa.

## Corrección preparada

Se reutiliza el adaptador F4-S existente. La rama cambia únicamente el valor predeterminado SANDBOX, la validación Joi, el guard de SPEC-09, el ejemplo de configuración y sus pruebas para usar `https://api-sandbox.comprobanteselectronicos.go.cr/recepcion/v1`. El guard rechaza ahora la URL antigua y mantiene inalcanzables los endpoints productivos en el modo local. No cambian el IDP, el cliente OAuth, los encabezados, el cuerpo, la firma, las credenciales ni la lógica de estados.

Antes de instalar la corrección habría que actualizar **por separado** el valor explícito de `HACIENDA_RECEPCION_SANDBOX_BASE_URL` en la configuración privada instalada, con respaldo y autorización. STAG y correo permanecen apagados. La factura `140adc48-7e4e-42bb-85bb-effe017483e2`, su clave, XML, pago y único intento se conservan. El primer paso externo futuro sería **solo consultar esa clave** en la ruta dedicada bajo autorización separada. Un 404 por sí solo no autoriza reenvío; `RETRY_SAFE=NO`.

## Validación local

- 152/152 pruebas focales: configuración, guard, OAuth, recepción POST/GET simulados y verificador de credenciales.
- 396/396 pruebas F4-S con datos sintéticos y red simulada. El primer intento de esta suite quedó limitado por permisos de escritura del sandbox de herramientas; la repetición autorizada con escritura del worktree pasó íntegra.
- `npm run typecheck`: PASS. `npm run build`: PASS. ESLint de archivos modificados: PASS.
- El lint completo detectó dos errores de formato **preexistentes y ajenos a esta rama** en `src/modules/fiscal-intent-v2/__tests__/w2-b-lab-projection.spec.ts`; el error inicial en la prueba modificada se corrigió y su lint focal pasó.
- No se hizo POST/GET a Hacienda, no se emitió otra factura, no se cambió Docker ni configuración fiscal. `STAG_SENDING_ENABLED=NO`, `EMAIL_DELIVERY_ENABLED=NO`, `RETRY_SAFE=NO`.
