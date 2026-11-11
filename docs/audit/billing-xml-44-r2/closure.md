# BILLING-XML-44-R2 — cierre de laboratorio

Fecha: 2026-11-11. Rama aislada: `codex/billing-xml-44-r2`. SHA inicial `b0bef77b3d1ae4ec756855f61bfa6ac977c547c8` (contiene R1 `634114bc64bbfbfc248f14142cff74bc2aec79f5`). SHA final del código validado: `9fdf040727479f440b8d136eb460f472412bf97c`.

## Resultado

| Área | Estado | Evidencia y límite |
|---|---|---|
| R2 | `BILLING_XML_44_R2_PARTIAL` | El XML y la regresión final pasan; dos pruebas E2E agotaron 60 s bajo carga en la primera corrida. La segunda pasó, pero no demuestra que la latencia intermitente haya desaparecido. |
| Validación previa | PASS | XSD oficial sin modificar, tolerando únicamente una falta de firma raíz; aritmética fiscal independiente; rechazo de metadatos ambiguos antes de abrir la transacción de creación. |
| XSD firmado | PASS | FE y TE sintéticos pasan XSD oficial 4.4 después de la firma. FE SHA-256 `d384afef665573606f6499b2182d6070850ada8c93bc40fa7f0f3901a25b9cc8`; TE SHA-256 `aaa273b368997d47214c92455c22b851cb5ab6ef105dc571233268c1ef5fd6c7`. |
| Firma XAdES | PASS | Firma sintética verificada; el XML firmado menos el único nodo de firma coincide byte a byte con el XML fiscal previo. |
| Impuesto cero | PASS | Exento y tarifa 0 % explícitos en FE/TE; cero sin clasificación o con campos contradictorios rechazado. |
| IVA 13 % | PASS | Importe exacto a cinco decimales o redondeado a dos para el caso aprobado de Afiliaciones; base y totales conciliados. |
| Exoneración | `CONTRACT_GAP` | Falta evidencia de exoneración en DTO v1; no se fabrican nodos ni datos. |
| Compatibilidad Afiliaciones | PARTIAL | Exento e IVA 13 % sintéticos, crédito, CRC y N períodos son compatibles con el mapper inspeccionado; no hay perfil W2-A de IVA 0 % con crédito ni contrato de exoneración. La imagen instalada no se equipara al checkout de referencia. |
| Regresión | PARTIAL | 402/402 unitarias en 28 suites, 20/20 E2E en segunda corrida, `tsc --noEmit --incremental false` PASS. Primera corrida E2E 16/20 por dos timeouts y dos fixtures inconsistentes; estos últimos se corrigieron. La sensibilidad a carga permanece abierta. |
| Billing instalado | UNCHANGED | Checkout instalado en `ae4ae65e666e277fa930b77a6f3e0b6671c255ea`; sus cambios locales ajenos a esta rama no se editaron. IDs de contenedores instalados coinciden con el inventario inicial. |

## Cambios y evidencia

- Un clasificador compartido exige `taxAmount`, código, tarifa y tasa explícitos. Distingue exento, IVA 0 % e IVA gravado; verifica 13 % y 4 % estándar, y bloquea la clasificación de IVA 0 % sin crédito que el resumen aún no representa.
- La validación del XML sin firma ocurre antes de subir bytes. Después se verifica XAdES, la integridad exacta de los nodos fiscales y el XSD firmado. El timeout local XSD pasó de 10 a 30 s; no se modificó el timeout Prisma de W2-B.
- La matriz cubre FE/TE exento, 0 %, 13 %, mixto, crédito de dos períodos y casos negativos de metadatos, importes, orden, namespace y firma. El detalle está en `regression-results.md`.
- La base PostgreSQL de laboratorio tuvo 21/21 migraciones, cero pendientes y cero diferencias de checksum; se usaron rol, base y credenciales aleatorios, red deshabilitada y almacenamiento temporal. Contenedor y almacenamiento descartable fueron eliminados.
- La primera ejecución amplia de unidades tuvo 345/357 por fixtures anteriores inválidos; se corrigieron los datos sintéticos y la ejecución final pasó 402/402. La primera E2E tuvo 16/20 en 375,518 s; la segunda 20/20 en 105,521 s. Los dos timeouts de la primera son riesgo residual, no se ocultan ni se elevó el límite de Jest.

## Recomendación para W2-B

El código R2 queda listo **para una nueva validación aislada**, no para instalarse. Antes de autorizar una repetición de W2-B: (1) medir creación y concurrencia con carga controlada y resolver los timeouts intermitentes; (2) reconciliar la imagen y contrato M2M realmente instalados con este SHA y su esquema; (3) mantener W2-B `PARTIAL` hasta tratar su timeout Prisma/P2028 por separado; (4) aprobar el tratamiento fiscal y la evidencia de cada plan de Afiliaciones. Exoneración y tarifa 0 % con crédito requieren trabajo de contrato/perfil si se vuelven escenarios aprobados. No se inició W2-B ni W3.

`INSTALLED_DATABASE_MODIFIED = NO`

`INSTALLED_DOCKER_MODIFIED = NO`

`INSTALLED_BILLING_MODIFIED = NO`

`PRODUCTION_MIGRATIONS_EXECUTED = NO`

`REAL_FISCAL_DOCUMENTS_ISSUED = NO`

`HACIENDA_COMMUNICATION = NO`

`PUSHED = NO`

`MERGED = NO`
