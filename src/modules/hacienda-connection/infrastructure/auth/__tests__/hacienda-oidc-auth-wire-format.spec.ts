/**
 * TASK-002 — HaciendaOidcAuthAdapter OAuth token request wire format audit
 *
 * Verifies the actual URLSearchParams body sent to the Hacienda token endpoint.
 *
 * F4-S contract requirements (VERIFIED_CURRENT_OFFICIAL_CONTRACT):
 *   - grant_type=password
 *   - client_id=api-stag (sandbox) or api-prod (production)
 *   - username=<runtime secret>
 *   - password=<runtime secret>
 *   - Content-Type: application/x-www-form-urlencoded
 *
 * July 2025 Hacienda maintenance guidance:
 *   - scope MUST be OMITTED — not sent as empty, null or undefined
 *
 * Additional:
 *   - client_secret MUST NOT be invented or sent
 *   - Exactly 4 parameters — no extras
 *
 * No real Hacienda credentials are used. Mocks intercept the HTTP call.
 */

import { of } from 'rxjs';
import { HaciendaOidcAuthAdapter } from '../hacienda-oidc-auth.adapter';
import type { HttpService } from '@nestjs/axios';
import type { ConfigService } from '@nestjs/config';
import type { HaciendaAuthConfig } from '../../../../../infrastructure/config/hacienda-auth.config';

const SANDBOX_TOKEN_URL =
  'https://idp.comprobanteselectronicos.go.cr/auth/realms/rut-stag/protocol/openid-connect/token';
const PRODUCTION_TOKEN_URL =
  'https://idp.comprobanteselectronicos.go.cr/auth/realms/rut/protocol/openid-connect/token';

function makeConfigService(): ConfigService {
  const config: HaciendaAuthConfig = {
    idp: {
      sandboxTokenUrl: SANDBOX_TOKEN_URL,
      productionTokenUrl: PRODUCTION_TOKEN_URL,
      sandboxClientId: 'api-stag',
      productionClientId: 'api-prod',
    },
    authTimeoutMs: 10000,
    tokenExpirySafetyMarginMs: 30000,
    retry: { count5xx: 1, delay5xxMs: 2000 },
  };
  return {
    get: jest.fn().mockReturnValue(config),
  } as unknown as ConfigService;
}

interface CapturedRequest {
  url: string;
  body: string;
  config: Record<string, unknown>;
}

function makeAdapterWithSpy(): { adapter: HaciendaOidcAuthAdapter; captured: CapturedRequest } {
  const captured: CapturedRequest = { url: '', body: '', config: {} };

  const post = jest.fn().mockImplementation((url: string, body: unknown, config: unknown) => {
    captured.url = url;
    captured.body = body as string;
    captured.config = (config ?? {}) as Record<string, unknown>;
    return of({
      data: { access_token: 'synthetic-test-token', expires_in: 300 },
      status: 200,
      headers: {},
    });
  });

  const adapter = new HaciendaOidcAuthAdapter(makeConfigService(), {
    post,
  } as unknown as HttpService);

  return { adapter, captured };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('HaciendaOidcAuthAdapter — OAuth token request wire format (F4-S TASK-002)', () => {
  describe('Sandbox environment', () => {
    let captured: CapturedRequest;

    beforeEach(async () => {
      const spy = makeAdapterWithSpy();
      await spy.adapter.authenticate({ username: 'test-user', password: 'test-pass' }, 'SANDBOX');
      captured = spy.captured;
    });

    it('posts to the verified sandbox token endpoint', () => {
      expect(captured.url).toBe(SANDBOX_TOKEN_URL);
    });

    it('sends application/x-www-form-urlencoded Content-Type', () => {
      const headers = (captured.config as { headers?: Record<string, string> }).headers ?? {};
      expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    });

    it('sends grant_type=password', () => {
      expect(new URLSearchParams(captured.body).get('grant_type')).toBe('password');
    });

    it('sends client_id=api-stag for sandbox', () => {
      expect(new URLSearchParams(captured.body).get('client_id')).toBe('api-stag');
    });

    it('sends the username credential', () => {
      expect(new URLSearchParams(captured.body).get('username')).toBe('test-user');
    });

    it('sends the password credential', () => {
      expect(new URLSearchParams(captured.body).get('password')).toBe('test-pass');
    });

    /**
     * July 2025 Hacienda maintenance finding:
     * scope MUST be OMITTED — never sent as empty, null or any value.
     */
    it('MUST NOT include a scope parameter (July 2025 Hacienda requirement)', () => {
      const params = new URLSearchParams(captured.body);
      expect(params.has('scope')).toBe(false);
    });

    /** Client secret is not required by Hacienda ROPC — must not be invented. */
    it('MUST NOT include client_secret', () => {
      const params = new URLSearchParams(captured.body);
      expect(params.has('client_secret')).toBe(false);
    });

    it('sends exactly 4 parameters (grant_type, client_id, username, password) — no extras', () => {
      const params = new URLSearchParams(captured.body);
      const keys = [...params.keys()].sort();
      expect(keys).toEqual(['client_id', 'grant_type', 'password', 'username'].sort());
    });
  });

  describe('Production environment', () => {
    let captured: CapturedRequest;

    beforeEach(async () => {
      const spy = makeAdapterWithSpy();
      await spy.adapter.authenticate(
        { username: 'prod-user', password: 'prod-pass' },
        'PRODUCTION',
      );
      captured = spy.captured;
    });

    it('posts to the production token endpoint', () => {
      expect(captured.url).toBe(PRODUCTION_TOKEN_URL);
    });

    it('sends client_id=api-prod for production', () => {
      expect(new URLSearchParams(captured.body).get('client_id')).toBe('api-prod');
    });

    it('MUST NOT include a scope parameter for production either', () => {
      expect(new URLSearchParams(captured.body).has('scope')).toBe(false);
    });

    it('sends exactly 4 parameters for production too', () => {
      const keys = [...new URLSearchParams(captured.body).keys()].sort();
      expect(keys).toEqual(['client_id', 'grant_type', 'password', 'username'].sort());
    });
  });

  describe('Token response mapping', () => {
    it('maps access_token to accessToken', async () => {
      const { adapter } = makeAdapterWithSpy();
      const result = await adapter.authenticate({ username: 'u', password: 'p' }, 'SANDBOX');
      expect(result.accessToken).toBe('synthetic-test-token');
    });

    it('computes expiresAt from expires_in', async () => {
      const before = Date.now();
      const { adapter } = makeAdapterWithSpy();
      const result = await adapter.authenticate({ username: 'u', password: 'p' }, 'SANDBOX');
      expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 300 * 1000 - 100);
    });
  });
});
