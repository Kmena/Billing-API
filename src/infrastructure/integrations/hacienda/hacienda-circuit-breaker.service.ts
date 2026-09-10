import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isAxiosError } from 'axios';
import { HaciendaUnavailableException } from './exceptions/hacienda-unavailable.exception';
import type { HaciendaConfig } from '../../config/hacienda.config';

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * HaciendaCircuitBreaker — Three integrated outbound-protection mechanisms:
 *
 * 1. Proactive sliding-window rate limiter: configurable req/s (default ≤ 8, below Hacienda's 10 req/s limit).
 *    OQ-RA-005: burst 20 req/s (100/5s); sustained 10 req/s (1200/2min); 10-min block.
 *
 * 2. Circuit breaker state machine: CLOSED → OPEN (failureThreshold) → HALF_OPEN (resetTimeoutMs) → CLOSED
 *
 * 3. Retry with backoff:
 *    - 429: retry up to count429 times using baseDelay429Ms * (attempt + 1) linear backoff
 *    - 5xx/network: retry up to count5xx times after delay5xxMs
 *    - Other errors: throw immediately
 *
 * All thresholds are configurable via environment variables with production-safe defaults.
 */
@Injectable()
export class HaciendaCircuitBreaker {
  private readonly logger = new Logger(HaciendaCircuitBreaker.name);

  // Circuit breaker state
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private nextAttemptTime = 0;
  private readonly FAILURE_THRESHOLD: number;
  private readonly RESET_TIMEOUT_MS: number;

  // Proactive rate limiter
  private requestTimestamps: number[] = [];
  private readonly OUTBOUND_MAX_PER_SECOND: number;

  // Retry configuration
  private readonly RETRY_429_COUNT: number;
  private readonly RETRY_429_BASE_DELAY_MS: number;
  private readonly RETRY_5XX_COUNT: number;
  private readonly RETRY_5XX_DELAY_MS: number;

  constructor(@Optional() configService?: ConfigService) {
    const cb = configService?.get<HaciendaConfig>('hacienda')?.circuitBreaker;
    const retry = configService?.get<HaciendaConfig>('hacienda')?.retry;

    this.FAILURE_THRESHOLD = cb?.failureThreshold ?? 5;
    this.RESET_TIMEOUT_MS = cb?.resetTimeoutMs ?? 30_000;
    this.OUTBOUND_MAX_PER_SECOND = cb?.outboundRatePerSecond ?? 8;

    this.RETRY_429_COUNT = retry?.count429 ?? 2;
    this.RETRY_429_BASE_DELAY_MS = retry?.baseDelay429Ms ?? 1000;
    this.RETRY_5XX_COUNT = retry?.count5xx ?? 1;
    this.RETRY_5XX_DELAY_MS = retry?.delay5xxMs ?? 2000;
  }

  /**
   * Execute a function with:
   * - Proactive rate limiting (≤ OUTBOUND_MAX_PER_SECOND req/s)
   * - Circuit breaker (OPEN → reject without HTTP call)
   * - Retry with backoff (429 → linear; 5xx → fixed)
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Fast-fail if circuit is open
    if (this.state === 'OPEN') {
      if (Date.now() < this.nextAttemptTime) {
        throw new HaciendaUnavailableException('circuit-open');
      }
      this.state = 'HALF_OPEN';
      this.logger.warn('HaciendaCircuitBreaker: OPEN → HALF_OPEN (testing connection)');
    }

    await this.enforceOutboundRateLimit();
    return this.executeWithRetry(fn);
  }

  private async enforceOutboundRateLimit(): Promise<void> {
    const now = Date.now();
    const windowStart = now - 1000;
    this.requestTimestamps = this.requestTimestamps.filter((t) => t > windowStart);

    if (this.requestTimestamps.length >= this.OUTBOUND_MAX_PER_SECOND) {
      const oldestTs = this.requestTimestamps[0];
      const waitMs = 1000 - (now - oldestTs) + 10; // +10ms safety buffer
      if (waitMs > 0) {
        if (waitMs > 200) {
          this.logger.debug(
            `Outbound rate limit: waiting ${waitMs}ms (${this.requestTimestamps.length} req in window)`,
          );
        }
        await sleep(waitMs);
      }
      return this.enforceOutboundRateLimit();
    }

    this.requestTimestamps.push(Date.now());
  }

  private async executeWithRetry<T>(fn: () => Promise<T>, attempt = 0): Promise<T> {
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      if (isAxiosError(err)) {
        const status = err.response?.status;

        // HTTP 429 from Hacienda — retry with linear backoff
        if (status === 429) {
          if (attempt < this.RETRY_429_COUNT) {
            const delay = this.RETRY_429_BASE_DELAY_MS * (attempt + 1);
            this.logger.warn(
              `Hacienda 429 — retry ${attempt + 1}/${this.RETRY_429_COUNT} after ${delay}ms`,
            );
            await sleep(delay);
            await this.enforceOutboundRateLimit();
            return this.executeWithRetry(fn, attempt + 1);
          }
          this.onFailure();
          throw new HaciendaUnavailableException('hacienda-rate-limited');
        }

        // HTTP 5xx or network timeout — configurable retry
        if (
          (status !== undefined && status >= 500) ||
          err.code === 'ECONNABORTED' ||
          !err.response
        ) {
          if (attempt < this.RETRY_5XX_COUNT) {
            this.logger.warn(
              { status, code: err.code },
              `Hacienda transient error — retry ${attempt + 1}/${this.RETRY_5XX_COUNT} after ${this.RETRY_5XX_DELAY_MS}ms`,
            );
            await sleep(this.RETRY_5XX_DELAY_MS);
            await this.enforceOutboundRateLimit();
            return this.executeWithRetry(fn, attempt + 1);
          }
          this.onFailure();
          throw new HaciendaUnavailableException('hacienda-server-error');
        }
      }

      // Other errors — fail immediately
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;
    if (this.state === 'HALF_OPEN') {
      this.state = 'CLOSED';
      this.logger.warn('HaciendaCircuitBreaker: HALF_OPEN → CLOSED (connection restored)');
    }
  }

  private onFailure(): void {
    this.failureCount++;
    if (this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
      this.nextAttemptTime = Date.now() + this.RESET_TIMEOUT_MS;
      this.logger.warn(
        `HaciendaCircuitBreaker: HALF_OPEN → OPEN (test call failed; next attempt in ${this.RESET_TIMEOUT_MS / 1000}s)`,
      );
    } else if (this.failureCount >= this.FAILURE_THRESHOLD && this.state === 'CLOSED') {
      this.state = 'OPEN';
      this.nextAttemptTime = Date.now() + this.RESET_TIMEOUT_MS;
      this.logger.warn(
        `HaciendaCircuitBreaker: CLOSED → OPEN (${this.failureCount} consecutive failures)`,
      );
    }
  }

  /** Exposed for testing only — do not call from production code */
  _getState(): CircuitState {
    return this.state;
  }

  _getFailureCount(): number {
    return this.failureCount;
  }
}
