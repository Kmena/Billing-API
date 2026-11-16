# BILLING-XML-44-R1 — cierre de laboratorio

## Estado

| Dimensión | Resultado |
|---|---|
| BILLING-XML-44-R1 | **PARTIAL** |
| Causa raíz | CONFIRMADA: condición de impuesto no cero omitía nodos obligatorios de línea |
| Serializador | FIXED para exento IVA código `10`, 0 % con crédito código `01` e IVA 13 % |
| XSD oficial 4.4 | PASS en XML firmado de FE/TE soportados |
| XML sin firmar, XSD íntegro | FAIL únicamente porque `ds:Signature` es obligatorio en el esquema oficial |
| XML firmado | PASS para A/B/C/D/E y tiquete exento |
| Firma XAdES sintética | PASS, verificación independiente de XSD |
| Regresión | PARTIAL: corridas amplias con dos fallos intermitentes; ambas suites pasaron aisladas. E2E documentos, persistencia, firma e idempotencia pasaron sobre DB descartable |
| Compatibilidad M2M | PARTIAL: código de API/M2M sin cambios y pruebas de autorización PASS; despliegue/contrato instalado no probado |
| Billing instalado | UNCHANGED |

## Evidencia y trazabilidad

- Billing base `3b0893fb02bbe0fb6e51ebcda795a7d1555f3820`; commit de corrección `634114bc64bbfbfc248f14142cff74bc2aec79f5`; rama `codex/billing-xml-44-r1`.
- Billing instalado observado en `ae4ae65e666e277fa930b77a6f3e0b6671c255ea`; no se modificó. El diagnóstico W2-B-R1 de Afiliaciones está en `a46f6ef` sobre `f9db39a`.
- XSD FE oficial 4.4 SHA-256 `d384afef665573606f6499b2182d6070850ada8c93bc40fa7f0f3901a25b9cc8`; XSD TE oficial `aaa273b368997d47214c92455c22b851cb5ab6ef105dc571233268c1ef5fd6c7`.
- Antes: 1/2/0/1 errores XSD firmados para A/B/C/D. Después: cero errores en A/B/C/D/E; la firma verifica en todos. Totales CRC: 10000, 20000, 11300, 21300 y 10000 con cinco decimales.
- Suite nueva 10/10 PASS. Regresión unitaria amplia 144/145 y luego preparación XML aislada 8/8 PASS; otras suites 51/51, 4/4 y 71/71 PASS. E2E documentos/persistencia 10/10 PASS; corrida ampliada 19/20 y luego concurrencia aislada 7/7 PASS. Detalle en `xml-44-regression.md`.
- PostgreSQL y almacenamiento del laboratorio fueron temporales y se eliminaron tras cada corrida. Las 21 migraciones se aplicaron solo a esas bases descartables. El runtime de prueba no tuvo red exterior, puertos publicados ni volúmenes instalados.

## Pendientes y recomendación

1. `UNSIGNED_XSD_PASS` literal es incompatible con la cardinalidad de firma del XSD oficial. Se validó que, antes de firmar, la estructura fiscal solo produce ese error esperado. La especificación debe distinguir validación estructural previa de validación XSD completa posterior a la firma.
2. La exoneración válida no se pudo probar: los DTO/snapshots no aportan los campos fiscales de `Exoneracion`. No se inventaron datos ni se alteró el contrato M2M. El código `11` sin crédito también queda rechazado.
3. Las solicitudes con impuesto cero y sin metadatos continúan siendo admisibles a nivel DTO pero ahora fallan cerradas en serialización. Antes generaban XML XSD inválido. Los consumidores deberán enviar el código/tarifa correctos y validar esta exigencia antes de adopción.
4. Repetir la regresión integral en un laboratorio estable y revisar los dos fallos intermitentes observados bajo carga. No hay prueba de aceptación de Hacienda ni preparación de producción.

La corrección permite planear una repetición de W2-B únicamente tras resolver los requisitos de metadatos, acordar el criterio pre-firma y autorizar expresamente esa nueva fase. Este cierre no inicia W2-B ni W3.

INSTALLED_DATABASE_MODIFIED = NO

INSTALLED_DOCKER_MODIFIED = NO

INSTALLED_BILLING_MODIFIED = NO

PRODUCTION_MIGRATIONS_EXECUTED = NO

REAL_FISCAL_DOCUMENTS_ISSUED = NO

HACIENDA_COMMUNICATION = NO

PUSHED = NO

MERGED = NO
