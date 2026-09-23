/**
 * TASK-005 — F4-S Adapter Assertion tests
 *
 * Verifies:
 *   - MockHaciendaAuthAdapter is detected and rejected in live mode
 *   - MockHaciendaSubmissionAdapter is detected and rejected in live mode
 *   - HaciendaOidcAuthAdapter + HaciendaRecepcionAdapter pass in live mode
 *   - USE_REAL_HACIENDA not set → USE_REAL_HACIENDA_NOT_SET (does not block normal CI)
 */

import {
  assertRealAdapters,
  getAdapterIdentity,
  isUseRealHaciendaEnabled,
  assertAdapterConfigForPreflight,
} from '../preflight/f4s-adapter-assertion';

// ── Fake adapter classes for testing ─────────────────────────────────────────
// These simulate the adapter class names without importing the real adapters.

class HaciendaOidcAuthAdapter {
  async authenticate() {
    return { accessToken: 'fake', expiresAt: new Date() };
  }
}
class HaciendaRecepcionAdapter {
  async submitSignedDocument() {
    return {
      kind: 'ACKNOWLEDGED' as const,
      nextStatus: 'ACKNOWLEDGED' as const,
      httpStatus: 201,
      providerReference: 'fake',
    };
  }
}
class MockHaciendaAuthAdapter {
  async authenticate() {
    return { accessToken: 'mock', expiresAt: new Date() };
  }
}
class MockHaciendaSubmissionAdapter {
  async submitSignedDocument() {
    return {
      kind: 'ACKNOWLEDGED' as const,
      nextStatus: 'ACKNOWLEDGED' as const,
      httpStatus: 201,
      providerReference: 'mock',
    };
  }
}

// ── getAdapterIdentity ────────────────────────────────────────────────────────

describe('getAdapterIdentity', () => {
  it('returns class name for HaciendaOidcAuthAdapter', () => {
    expect(getAdapterIdentity(new HaciendaOidcAuthAdapter())).toBe('HaciendaOidcAuthAdapter');
  });

  it('returns class name for MockHaciendaAuthAdapter', () => {
    expect(getAdapterIdentity(new MockHaciendaAuthAdapter())).toBe('MockHaciendaAuthAdapter');
  });

  it('returns unknown for null', () => {
    expect(getAdapterIdentity(null)).toBe('unknown');
  });

  it('returns unknown for plain object with no constructor name', () => {
    const anon = Object.create(null) as object;
    expect(getAdapterIdentity(anon)).toBe('unknown');
  });
});

// ── isUseRealHaciendaEnabled ──────────────────────────────────────────────────

describe('isUseRealHaciendaEnabled', () => {
  afterEach(() => {
    delete process.env['USE_REAL_HACIENDA'];
  });

  it('returns false when not set', () => {
    delete process.env['USE_REAL_HACIENDA'];
    expect(isUseRealHaciendaEnabled()).toBe(false);
  });

  it('returns false when set to false', () => {
    process.env['USE_REAL_HACIENDA'] = 'false';
    expect(isUseRealHaciendaEnabled()).toBe(false);
  });

  it('returns true when set to true', () => {
    process.env['USE_REAL_HACIENDA'] = 'true';
    expect(isUseRealHaciendaEnabled()).toBe(true);
  });
});

// ── assertRealAdapters ────────────────────────────────────────────────────────

describe('assertRealAdapters', () => {
  afterEach(() => {
    delete process.env['USE_REAL_HACIENDA'];
  });

  it('returns USE_REAL_HACIENDA_NOT_SET when flag is absent (normal CI behavior)', () => {
    delete process.env['USE_REAL_HACIENDA'];
    const result = assertRealAdapters(
      new HaciendaOidcAuthAdapter(),
      new HaciendaRecepcionAdapter(),
    );
    expect(result.status).toBe('USE_REAL_HACIENDA_NOT_SET');
  });

  it('rejects MockHaciendaAuthAdapter when USE_REAL_HACIENDA=true', () => {
    process.env['USE_REAL_HACIENDA'] = 'true';
    const result = assertRealAdapters(
      new MockHaciendaAuthAdapter(),
      new HaciendaRecepcionAdapter(),
    );
    expect(result.status).toBe('MOCK_ADAPTER_DETECTED');
    expect(result.authAdapterIdentity).toBe('MockHaciendaAuthAdapter');
    expect(result.message).toContain('MockHaciendaAuthAdapter');
  });

  it('rejects MockHaciendaSubmissionAdapter when USE_REAL_HACIENDA=true', () => {
    process.env['USE_REAL_HACIENDA'] = 'true';
    const result = assertRealAdapters(
      new HaciendaOidcAuthAdapter(),
      new MockHaciendaSubmissionAdapter(),
    );
    expect(result.status).toBe('MOCK_ADAPTER_DETECTED');
    expect(result.submissionAdapterIdentity).toBe('MockHaciendaSubmissionAdapter');
    expect(result.message).toContain('MockHaciendaSubmissionAdapter');
  });

  it('confirms real adapters when USE_REAL_HACIENDA=true', () => {
    process.env['USE_REAL_HACIENDA'] = 'true';
    const result = assertRealAdapters(
      new HaciendaOidcAuthAdapter(),
      new HaciendaRecepcionAdapter(),
    );
    expect(result.status).toBe('REAL_ADAPTERS_CONFIRMED');
    expect(result.authAdapterIdentity).toBe('HaciendaOidcAuthAdapter');
    expect(result.submissionAdapterIdentity).toBe('HaciendaRecepcionAdapter');
  });

  it('does NOT abort or throw — returns a result for caller to act on', () => {
    process.env['USE_REAL_HACIENDA'] = 'true';
    expect(() =>
      assertRealAdapters(new MockHaciendaAuthAdapter(), new MockHaciendaSubmissionAdapter()),
    ).not.toThrow();
    const result = assertRealAdapters(
      new MockHaciendaAuthAdapter(),
      new MockHaciendaSubmissionAdapter(),
    );
    expect(result.status).toBe('MOCK_ADAPTER_DETECTED');
  });
});

// ── assertAdapterConfigForPreflight ──────────────────────────────────────────

describe('assertAdapterConfigForPreflight', () => {
  afterEach(() => {
    delete process.env['USE_REAL_HACIENDA'];
  });

  it('returns USE_REAL_HACIENDA_NOT_SET when flag is absent', () => {
    delete process.env['USE_REAL_HACIENDA'];
    const result = assertAdapterConfigForPreflight();
    expect(result.status).toBe('USE_REAL_HACIENDA_NOT_SET');
  });

  it('returns REAL_ADAPTERS_CONFIRMED (pending) when USE_REAL_HACIENDA=true', () => {
    process.env['USE_REAL_HACIENDA'] = 'true';
    const result = assertAdapterConfigForPreflight();
    expect(result.status).toBe('REAL_ADAPTERS_CONFIRMED');
    expect(result.authAdapterIdentity).toBe('pending-instantiation');
  });
});
