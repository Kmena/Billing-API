import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ScopeGuard } from '../scope.guard';
import { SCOPES_KEY } from '../../decorators/scopes.decorator';

function makeMockContext(apiKey?: { scopes: string[] } | null): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ apiKey }),
    }),
  } as unknown as ExecutionContext;
}

function makeReflector(scopes: string[] | undefined): Reflector {
  return {
    getAllAndOverride: (_key: string, _targets: unknown[]) => scopes,
  } as unknown as Reflector;
}

describe('ScopeGuard', () => {
  describe('when no scopes are declared', () => {
    it('returns true regardless of request contents', () => {
      const guard = new ScopeGuard(makeReflector(undefined));
      const ctx = makeMockContext(undefined);
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('returns true even with empty scopes array', () => {
      const guard = new ScopeGuard(makeReflector([]));
      const ctx = makeMockContext(undefined);
      expect(guard.canActivate(ctx)).toBe(true);
    });
  });

  describe('when scopes are declared', () => {
    it('FAIL-CLOSED: throws INSUFFICIENT_SCOPE when request.apiKey is absent', () => {
      const guard = new ScopeGuard(makeReflector([SCOPES_KEY, 'taxpayers:read']));
      const ctx = makeMockContext(undefined);
      // Explicitly test with declared scopes
      const guard2 = new ScopeGuard(makeReflector(['taxpayers:read']));
      expect(() => guard2.canActivate(makeMockContext(undefined))).toThrow(ForbiddenException);
      try {
        guard2.canActivate(makeMockContext(undefined));
      } catch (err) {
        const fe = err as ForbiddenException;
        const response = fe.getResponse() as { code: string };
        expect(response.code).toBe('INSUFFICIENT_SCOPE');
      }
      void guard;
      void ctx;
    });

    it('returns true when API key has all required scopes', () => {
      const guard = new ScopeGuard(makeReflector(['taxpayers:read']));
      const ctx = makeMockContext({ scopes: ['taxpayers:read', 'cabys:read'] });
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('throws INSUFFICIENT_SCOPE when API key is missing a required scope', () => {
      const guard = new ScopeGuard(makeReflector(['taxpayers:read']));
      const ctx = makeMockContext({ scopes: ['cabys:read'] });
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('AND semantics: throws when only some scopes are present', () => {
      const guard = new ScopeGuard(makeReflector(['taxpayers:read', 'cabys:read']));
      const ctx = makeMockContext({ scopes: ['taxpayers:read'] });
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('AND semantics: returns true when ALL multiple scopes are present', () => {
      const guard = new ScopeGuard(makeReflector(['taxpayers:read', 'cabys:read']));
      const ctx = makeMockContext({
        scopes: ['taxpayers:read', 'cabys:read', 'exchange-rates:read'],
      });
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('includes INSUFFICIENT_SCOPE code in ForbiddenException response', () => {
      const guard = new ScopeGuard(makeReflector(['taxpayers:read']));
      const ctx = makeMockContext({ scopes: [] });
      try {
        guard.canActivate(ctx);
        fail('Should have thrown');
      } catch (err) {
        const fe = err as ForbiddenException;
        const response = fe.getResponse() as { code: string };
        expect(response.code).toBe('INSUFFICIENT_SCOPE');
      }
    });
  });
});
