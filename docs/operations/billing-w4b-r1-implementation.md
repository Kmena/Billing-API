# Billing W4-B-R1 — implementación acotada

Base `3259908ae648e2e730947a4fe8b9c292210dab0e`, rama `codex/billing-spec-af-w4b-r1`. La rama parte de R2, que contiene R1 por ancestro. `main` local es `e7f8fff87cc1fe1f4122fe6544957ab0c001b757`; R1/R2 no son ancestros de ese `main`.

## Hallazgo reutilizable

La rama histórica `codex/billing-nc-nd-functional` (`53907fa`) tiene un motor **de laboratorio** de NC/ND v2, con reserva idempotente, referencia fiscal, XML firmado y XSD, pero depende de los módulos de consumidor y factura v2 de las waves W1–W3 de Billing. Su `W3AFiscalLabModule` permanece fuera de `AppModule`. No constituye un endpoint disponible en R2 ni en la instalación. Su documentación declara pendientes DF-06/ADR-BIL-014 para semántica tributaria. Integrar la rama entera agregaría cambios ajenos a W4-B-R1 y alteraría el camino de facturas ordinarias; requiere revisión independiente.

## Cambio realizado

Se incorporó únicamente el XSD oficial `NotaCreditoElectronica.xsd` v4.4 fijado por SHA-256 y su metadato; el validador local puede compilarlo explícitamente como `CREDIT_NOTE`. La ruta habitual de factura y tiquete sigue seleccionando los mismos XSD. No se añadió `CREDIT_NOTE` al enum Prisma, no hay migración, serializador NC, firma NC, solicitud M2M, envío ni activación de producción. La prueba del esquema es preparación técnica, **no** una NC fiscal.

## Gate fiscal y contable

AF-DEC-005 define NC total, original inmutable y sustituta opcional editable. No existe aprobación específica para el código de referencia, período contable, tratamiento de pagos aplicados ni reasignación de obligaciones. El [Reglamento, artículo 10](https://www.hacienda.go.cr/docs/REGLAMENTO_DE_COMPROBANTES_ELECTRONICOS.pdf) distingue la corrección de un comprobante válido del rechazo por Hacienda; el [Anexo v4.4](https://www.hacienda.go.cr/docs/ANEXOS_Y_ESTRUCTURAS_V4.4.pdf) contiene los códigos de referencia. Elegir su uso comercial concreto requiere la decisión fiscal pendiente. Por ello se detuvo la operación afectada según el gate de W4-B-R1. ND permanece `ND_POLICY_PENDING`.
