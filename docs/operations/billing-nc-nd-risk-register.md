# Riesgos y dependencias W4-B-R2

| ID | Riesgo / dependencia | Estado / mitigación |
|---|---|---|
| R1 | Código de referencia, período contable y tratamiento de pagos sin decisión fiscal | Bloqueo de emisión real; solicitud de laboratorio exige código explícito. |
| R2 | PostgreSQL descartable no disponible sin usar Docker instalado | Persistencia, concurrencia, migraciones y recuperación HTTP no declaradas PASS. |
| R3 | `main` no contiene R1/R2 y diverge de la base | Integración selectiva y regresión en candidato nuevo antes de merge. |
| R4 | NC total duplicada por claves distintas | Bloqueo de original e índice único parcial; falta prueba con dos conexiones PostgreSQL. |
| R5 | Auditoría común es fire and forget | Nueva fila `fiscal_note_audit` se escribe en la transacción; validar en PostgreSQL. |
| R6 | ND con importes comerciales no aprobados | Solo fixture explícito de laboratorio; no se modela reversión de NC. |
| R7 | Entorno instalado podría contener datos de notas creados fuera del módulo | Guards en servicio, preparación de XML, worker y adaptador Hacienda rechazan emisión; revisar rutas indirectas en candidato de promoción. |
