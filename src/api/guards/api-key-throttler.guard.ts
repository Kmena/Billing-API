import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { ApiKey } from '../../modules/api-keys/domain/entities/api-key.entity';

/**
 * Layer A — Per-API-Key inbound rate limiting.
 * Uses ApiKey ID as the throttle tracker key, giving each key its own limit bucket.
 * Applied on API Key–authenticated controllers (Taxpayers, CABYS, ExchangeRates).
 * Default: 100 req/min per API Key (configurable via THROTTLE_API_LIMIT + THROTTLE_API_TTL).
 */
@Injectable()
export class ApiKeyThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    // Use API Key ID for per-key rate limiting; fallback to IP if key absent
    const apiKey = req['apiKey'] as ApiKey | undefined;
    return apiKey?.id ?? (req['ip'] as string) ?? 'unknown';
  }

  protected async shouldSkip(_context: ExecutionContext): Promise<boolean> {
    return false;
  }
}
