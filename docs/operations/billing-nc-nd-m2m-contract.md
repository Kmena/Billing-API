# Contrato M2M NC/ND, laboratorio v1

El módulo `CorrectiveNotesLabModule` no está importado por ningún entrypoint instalado. Su controlador usa `ApiKeyAuthGuard`, `ScopeGuard` y la asociación `apiKeyCompany`. Prefijo del controlador: `lab/companies/:companyId/fiscal-documents/:environment`, con `environment=SANDBOX` exclusivamente. El prefijo global de la aplicación se aplica al montar el módulo de pruebas.

| Operación | Ruta relativa | Scope |
|---|---|---|
| Crear NC | `POST credit-notes` | `credit-notes:write` |
| Crear ND | `POST debit-notes` | `debit-notes:write` |
| Leer NC/ND | `GET credit-notes/:id`, `GET debit-notes/:id` | `*:read` del tipo correspondiente |
| Recuperar por clave | `GET credit-notes/by-key/:key`, `GET debit-notes/by-key/:key` | `*:read` del tipo correspondiente |
| Preparar XML firmado | `POST credit-notes/:id/prepare-xml`, `POST debit-notes/:id/prepare-xml` | `*:write` del tipo correspondiente |

POST requiere `X-API-Key`, `Idempotency-Key` y `{sourceDocumentId, referenceCode, reason}`. ND requiere además `lines` con el DTO fiscal existente. NC rechaza líneas del consumidor y copia la factura original. La clave idempotente se limita por tenant, empresa, API key, operación y clave. GET por clave recupera después de timeout; una reserva todavía incompleta responde `IDEMPOTENCY_REQUEST_IN_PROGRESS` (409). Errores estructurados usan `{code}`. No hay ruta `submit` para NC/ND.

**Estado:** contrato implementado en código y compilado, integración HTTP con base descartable pendiente.
