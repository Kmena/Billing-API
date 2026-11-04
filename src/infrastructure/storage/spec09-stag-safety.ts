/** Exact external-connection combinations permitted by the local SPEC-09 sandbox. */
export function isSafeSpec09ExternalMode(env: NodeJS.ProcessEnv): boolean {
  if (env.BILLING_SPEC09_STAG_INVOICING !== 'true')
    return env.USE_REAL_HACIENDA === 'false' && env.FISCAL_WORKER_ENABLE_IN_TESTS === 'false';
  return (
    env.USE_REAL_HACIENDA === 'true' &&
    env.FISCAL_WORKER_ENABLE_IN_TESTS === 'true' &&
    env.HACIENDA_RECEPCION_SANDBOX_BASE_URL ===
      'https://api.comprobanteselectronicos.go.cr/recepcion-sandbox/v1/' &&
    env.HACIENDA_IDP_SANDBOX_URL ===
      'https://idp.comprobanteselectronicos.go.cr/auth/realms/rut-stag/protocol/openid-connect/token' &&
    env.HACIENDA_RECEPCION_PRODUCTION_BASE_URL === 'https://127.0.0.1:9/' &&
    env.HACIENDA_IDP_PRODUCTION_URL === 'https://127.0.0.1:9/'
  );
}
