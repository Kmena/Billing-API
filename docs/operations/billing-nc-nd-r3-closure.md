# Cierre técnico W4-B-R3

**BILLING_NC_ND_TECHNICAL_PASS_LAB.** Base `11eb072e7aff2edc098151ef342c2e6a38f1b8c2`; rama `codex/billing-spec-af-w4b-r3`; commit de implementación `36f799d066c2cffadae565647b028b76ca9893bf`. El SHA del commit documental, que es la punta final de la rama, se registra en la entrega final (`git rev-parse HEAD`), porque un commit no puede incluir su propio SHA en su contenido.

| Capacidad | Resultado |
|---|---|
| NC y ND | PASS_LAB |
| Persistencia, relaciones y auditoría | PASS_LAB |
| M2M HTTP real | PASS_LAB |
| Idempotencia y concurrencia PostgreSQL | PASS_LAB |
| Seguridad multiempresa | PASS_LAB |
| XML/XSD NC y ND v4.4, firma XAdES sintética | PASS_LAB |
| Recuperación y fallos observados | PASS_LAB, con límite de frontera de commit |
| Regresión relevante | PASS: 93 pruebas, 0 FAIL, 0 SKIP, 0 TIMEOUT |
| Migraciones | PASS_LAB: 23 desde cero y checksums NC/ND coincidentes |
| Emisión fiscal real | BLOCKED |

La evidencia incluye POST/GET/by-key de ambos tipos, reinicio de API, desconexión descartable, respuestas interrumpidas, errores de firma/XSD y no duplicación. El módulo de prueba no está importado por el entrypoint instalado. No hubo operación de Hacienda ni envío de nota. El PASS se limita al laboratorio y no aprueba decisiones fiscales comerciales ni promoción a `main`.

- `INSTALLED_DATABASE_MODIFIED = NO`
- `INSTALLED_DOCKER_MODIFIED = NO`
- `INSTALLED_BILLING_MODIFIED = NO`
- `PRODUCTION_MIGRATIONS_EXECUTED = NO`
- `REAL_FISCAL_DOCUMENTS_ISSUED = NO`
- `HACIENDA_COMMUNICATION = NO`
- `PUSHED = NO`
- `MERGED = NO`
