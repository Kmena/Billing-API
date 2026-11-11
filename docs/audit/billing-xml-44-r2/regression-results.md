# BILLING-XML-44-R2 — resultados de regresión

Fecha: 2026-11-11. Base R1: `b0bef77b3d1ae4ec756855f61bfa6ac977c547c8` (incluye `634114bc64bbfbfc248f14142cff74bc2aec79f5`). Rama: `codex/billing-xml-44-r2`. Todas las pruebas usaron emisor, receptor, certificados y credenciales sintéticos; el contenedor de prueba no tuvo red hacia Hacienda ni correo.

## Esquemas y laboratorio

| Recurso | Evidencia |
|---|---|
| XSD FE 4.4 | SHA-256 `d384afef665573606f6499b2182d6070850ada8c93bc40fa7f0f3901a25b9cc8`; compilado con `xmlschema` 4.3.2 y XSD 1.1 |
| XSD TE 4.4 | SHA-256 `aaa273b368997d47214c92455c22b851cb5ab6ef105dc571233268c1ef5fd6c7`; se montaron los bytes originales del blob Git |
| PostgreSQL | Contenedor `postgres:15-alpine` con `--network none`, almacenamiento `tmpfs`, rol y base aleatorios, marcador de ejecución y credenciales sintéticas; 21/21 migraciones aplicadas, 21 archivos, cero pendientes y cero diferencias de checksum |
| Limpieza | Contenedor y almacenamiento descartable eliminados tras las dos corridas E2E; ningún volumen instalado se montó |

## Matriz fiscal

`PASS` en las filas soportadas significa: contrato previo válido, estructura FE/TE sin firma validada con el XSD oficial permitiendo únicamente la firma ausente, firma XAdES sintética verificada y XML firmado validado contra el XSD oficial. Las comprobaciones de importes comparan base, impuesto, línea y resumen.

| Escenario | Previa | XSD final | Firma | Resultado |
|---|---|---|---|---|
| FE: una línea exenta | PASS | PASS | PASS | PASS_LAB |
| FE: dos líneas exentas | PASS | PASS | PASS | PASS_LAB |
| FE: IVA 0 % explícito | PASS | PASS | PASS | PASS_LAB |
| FE: IVA 13 % | PASS | PASS | PASS | PASS_LAB |
| FE: líneas mixtas exento/0 %/13 % | PASS | PASS | PASS | PASS_LAB |
| FE: crédito con enero y febrero, ₡10.000 cada uno, marzo excluido | PASS; ₡20.000 y dos períodos | PASS | PASS | PASS_LAB |
| TE: exento, IVA 0 %, IVA 13 % y mixto | PASS | PASS | PASS | PASS_LAB |
| Cero sin código, tarifa o tasa; código/tarifa inválido | REJECT antes de persistir | SKIP | SKIP | PASS, rechazo explícito |
| IVA 13 % contradictorio; base o total XML alterado | REJECT | SKIP | SKIP | PASS, rechazo explícito |
| Namespace, orden o campo obligatorio XML incorrecto | REJECT | SKIP | SKIP | PASS, rechazo explícito |
| Firma alterada o cambio de bytes fiscales tras firmar | PASS | REJECT o no alcanza XSD | REJECT según alteración | PASS, rechazo explícito |
| Exoneración documentada | SKIP | SKIP | SKIP | `EXONERATION_CONTRACT_GAP`; DTO v1 carece de evidencia |

La prueba de dos períodos verifica líneas y totales sintéticos. La relación estructurada entre UUID de obligación/período y línea queda en Afiliaciones, no en el DTO v1 de Billing. No se declara aceptación de Hacienda.

## Ejecuciones

| Ejecución | Resultado | Duración y condiciones | Investigación |
|---|---|---|---|
| Conjunto dirigido inicial | 46/47 | Primera compilación de la matriz | Un fixture negativo quitaba `BaseImponible` de una línea inexistente; fixture corregido |
| Conjunto dirigido corregido | 48/48, cinco suites | 114,159 s; FE/TE, XSD, firma, metadatos | PASS |
| E2E descartable, intento 1 | 16/20; dos suites FAIL | 375,518 s; host con CPU alta, contenedor de prueba observado sobre 800 % | Dos pruebas excedieron timeout Jest 60 s; otras dos cambiaban precio sin cambiar impuesto y recibieron 400 en vez de 409. Se corrigieron esos dos payloads para conservar consistencia fiscal. No se oculta el fallo inicial. |
| E2E descartable, intento 2 | 20/20; cuatro suites PASS | 105,521 s; misma base descartable y nuevo proceso Jest | Creación, idempotencia, concurrencia, persistencia y firma pasan con payload válido. Persisten mensajes de PDF asíncrono al cerrar Jest; no cambian el resultado fiscal. |
| Regresión unitaria amplia inicial | 345/357; 23/26 suites PASS | 214,213 s; contenedor sin red | 12 fallos en tres suites por fixtures previos sin metadatos y un impuesto no ajustado tras descuento; fixtures corregidos. |
| Regresión unitaria amplia final | 402/402; 28/28 suites PASS | 344,36 s; contenedor sin red con código final montado en lectura; incluyó dos suites M2M | Confirma que los fixtures corregidos conservan cobertura de autorización, actividad, descuento y firma. La matriz R2 con tres categorías fiscales tardó 133,518 s bajo carga alta del host. |

El primer intento E2E no demuestra ausencia de problema de latencia. La diferencia entre 375,5 s y 105,5 s, con dos casos agotando exactamente el límite de 60 s solo bajo carga alta, apunta a saturación del laboratorio; falta repetir con medición de latencia en un host de carga controlada. La idempotencia se comprueba con un cambio **fiscalmente válido** de precio e impuesto: el servidor responde 409 sin documento duplicado; la solicitud fiscalmente inválida responde 400 antes de consultar el conflicto.

API v1 se cubre con el endpoint de documentos y su clave idempotente. No hay suite de emisión API v2 de este flujo en este checkout; no se atribuye cobertura v2 a las pruebas v1. La compatibilidad M2M con Afiliaciones se fundamenta en inspección de contrato y pruebas sintéticas; no se conectó una instalación.
