import { HaciendaCircuitBreaker } from '../hacienda-circuit-breaker.service';
import { HaciendaUnavailableException } from '../exceptions/hacienda-unavailable.exception';
import { ConfigService } from '@nestjs/config';

/** Build a HaciendaCircuitBreaker with optional config overrides. */
function makeBreaker(overrides?: {
  failureThreshold?: number;
  resetTimeoutMs?: number;
  outboundRatePerSecond?: number;
  count429?: number;
  baseDelay429Ms?: number;
  count5xx?: number;
  delay5xxMs?: number;
}): HaciendaCircuitBreaker {
  if (!overrides) {
    return new HaciendaCircuitBreaker();
  }

  const haciendaCfg = {
    circuitBreaker: {
      failureThreshold: overrides.failureThreshold ?? 5,
      resetTimeoutMs: overrides.resetTimeoutMs ?? 30_000,
      outboundRatePerSecond: overrides.outboundRatePerSecond ?? 8,
    },
    retry: {
      count429: overrides.count429 ?? 2,
      baseDelay429Ms: overrides.baseDelay429Ms ?? 1000,
      count5xx: overrides.count5xx ?? 1,
      delay5xxMs: overrides.delay5xxMs ?? 2000,
    },
  };

  const mockConfigService = {
    get: jest.fn().mockImplementation((key: string) => {
      if (key === 'hacienda') return haciendaCfg;
      return undefined;
    }),
  } as unknown as ConfigService;

  return new HaciendaCircuitBreaker(mockConfigService);
}

describe('HaciendaCircuitBreaker', () => {
  let breaker: HaciendaCircuitBreaker;

  beforeEach(() => {
    breaker = makeBreaker();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('normal operation (CLOSED state)', () => {
    it('executes function and returns result', async () => {
      const fn = jest.fn().mockResolvedValue('result');
      const result = await breaker.execute(fn);
      expect(result).toBe('result');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('resets failure count on success', async () => {
      let callCount = 0;
      const fn = jest.fn().mockImplementation(async () => {
        callCount++;
        if (callCount < 3) throw new Error('fail');
        return 'ok';
      });

      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(fn);
        } catch {
          // expected
        }
      }
      expect(breaker._getFailureCount()).toBe(2);

      jest.runAllTimers();
      await breaker.execute(jest.fn().mockResolvedValue('ok'));
      expect(breaker._getFailureCount()).toBe(0);
    });
  });

  describe('circuit breaker state machine', () => {
    it('transitions CLOSED → OPEN after 5 consecutive failures (default threshold)', async () => {
      const failFn = jest.fn().mockRejectedValue(new Error('server error'));

      for (let i = 0; i < 5; i++) {
        try {
          await breaker.execute(failFn);
        } catch {
          // expected
        }
      }

      expect(breaker._getState()).toBe('OPEN');
    });

    it('transitions CLOSED → OPEN after configured threshold of 3 failures (AC-005)', async () => {
      const customBreaker = makeBreaker({ failureThreshold: 3 });
      const failFn = jest.fn().mockRejectedValue(new Error('server error'));

      for (let i = 0; i < 3; i++) {
        try {
          await customBreaker.execute(failFn);
        } catch {
          // expected
        }
      }

      expect(customBreaker._getState()).toBe('OPEN');
    });

    it('does not open after 2 failures when threshold is 3 (AC-005)', async () => {
      const customBreaker = makeBreaker({ failureThreshold: 3 });
      const failFn = jest.fn().mockRejectedValue(new Error('server error'));

      for (let i = 0; i < 2; i++) {
        try {
          await customBreaker.execute(failFn);
        } catch {
          // expected
        }
      }

      expect(customBreaker._getState()).toBe('CLOSED');
    });

    it('OPEN state: rejects immediately without calling fn', async () => {
      const failFn = jest.fn().mockRejectedValue(new Error('fail'));
      for (let i = 0; i < 5; i++) {
        try {
          await breaker.execute(failFn);
        } catch {
          // trigger open
        }
      }

      const fn = jest.fn().mockResolvedValue('ok');
      await expect(breaker.execute(fn)).rejects.toBeInstanceOf(HaciendaUnavailableException);
      expect(fn).not.toHaveBeenCalled();
    });

    it('transitions OPEN → HALF_OPEN after default reset timeout of 30s', async () => {
      const failFn = jest.fn().mockRejectedValue(new Error('fail'));
      for (let i = 0; i < 5; i++) {
        try {
          await breaker.execute(failFn);
        } catch {
          // trigger open
        }
      }

      expect(breaker._getState()).toBe('OPEN');
      jest.advanceTimersByTime(31_000);

      const successFn = jest.fn().mockResolvedValue('ok');
      await breaker.execute(successFn);

      expect(breaker._getState()).toBe('CLOSED');
      expect(successFn).toHaveBeenCalledTimes(1);
    });

    it('transitions OPEN → HALF_OPEN after configured reset timeout of 5s (AC-006)', async () => {
      const customBreaker = makeBreaker({ failureThreshold: 2, resetTimeoutMs: 5_000 });
      const failFn = jest.fn().mockRejectedValue(new Error('fail'));

      for (let i = 0; i < 2; i++) {
        try {
          await customBreaker.execute(failFn);
        } catch {
          // trigger open
        }
      }

      expect(customBreaker._getState()).toBe('OPEN');

      // Should still be OPEN before timeout
      jest.advanceTimersByTime(4_999);
      await expect(customBreaker.execute(jest.fn())).rejects.toBeInstanceOf(
        HaciendaUnavailableException,
      );

      // Should allow attempt after timeout
      jest.advanceTimersByTime(2);
      const successFn = jest.fn().mockResolvedValue('recovered');
      await customBreaker.execute(successFn);
      expect(customBreaker._getState()).toBe('CLOSED');
    });

    it('HALF_OPEN → OPEN on failure', async () => {
      const failFn = jest.fn().mockRejectedValue(new Error('fail'));
      for (let i = 0; i < 5; i++) {
        try {
          await breaker.execute(failFn);
        } catch {
          // trigger open
        }
      }

      jest.advanceTimersByTime(31_000);

      const stillFailingFn = jest.fn().mockRejectedValue(new Error('still failing'));
      try {
        await breaker.execute(stillFailingFn);
      } catch {
        // expected
      }

      expect(breaker._getState()).toBe('OPEN');
    });
  });

  describe('outbound rate limiter (AC-007)', () => {
    it('delays the 6th request within 1 second when rate=5', async () => {
      jest.useRealTimers();
      const rateBreaker = makeBreaker({ outboundRatePerSecond: 5 });
      const fn = jest.fn().mockResolvedValue('ok');

      const start = Date.now();
      // Fire 6 requests; the 6th should be delayed
      for (let i = 0; i < 6; i++) {
        await rateBreaker.execute(fn);
      }
      const elapsed = Date.now() - start;

      expect(fn).toHaveBeenCalledTimes(6);
      // At least one delay must have been introduced (>= 500ms is conservative enough)
      expect(elapsed).toBeGreaterThan(500);
    }, 15_000);
  });

  describe('retry logic (via executeWithRetry)', () => {
    it('succeeds on second attempt after 429 using default retry config', async () => {
      jest.useRealTimers();

      const localBreaker = makeBreaker();
      let attempt = 0;
      const fn = jest.fn().mockImplementation(async () => {
        attempt++;
        if (attempt === 1) {
          const { AxiosError } = await import('axios');
          throw new AxiosError('Request failed with status 429', '429', undefined, undefined, {
            status: 429,
            data: '',
            headers: {},
            config: {} as never,
            statusText: 'Too Many Requests',
          });
        }
        return 'success';
      });

      const result = await localBreaker.execute(fn);
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    }, 10_000);

    it('exhausts configured 429 retries and throws HaciendaUnavailableException', async () => {
      jest.useRealTimers();

      // count429=1 means only 1 retry allowed
      const localBreaker = makeBreaker({ count429: 1, baseDelay429Ms: 50 });
      const fn = jest.fn().mockImplementation(async () => {
        const { AxiosError } = await import('axios');
        throw new AxiosError('Too Many Requests', '429', undefined, undefined, {
          status: 429,
          data: '',
          headers: {},
          config: {} as never,
          statusText: 'Too Many Requests',
        });
      });

      await expect(localBreaker.execute(fn)).rejects.toBeInstanceOf(HaciendaUnavailableException);
      // called: original attempt + 1 retry = 2
      expect(fn).toHaveBeenCalledTimes(2);
    }, 10_000);
  });
});
