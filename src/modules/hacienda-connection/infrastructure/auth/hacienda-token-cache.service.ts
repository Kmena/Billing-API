import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { HaciendaEnvironment } from '../../domain/entities/hacienda-connection.entity';
import type { HaciendaTokenResult } from '../../domain/ports/hacienda-auth.port';

@Injectable()
export class HaciendaTokenCache {
  private readonly store = new Map<string, HaciendaTokenResult>();
  private readonly safetyMarginMs: number;

  constructor(configService: ConfigService) {
    this.safetyMarginMs =
      configService.get<number>('haciendaAuth.tokenExpirySafetyMarginMs') ?? 30000;
  }

  getToken(companyId: string, environment: HaciendaEnvironment): string | null {
    const token = this.store.get(this.key(companyId, environment));
    if (!token || token.expiresAt.getTime() - Date.now() <= this.safetyMarginMs) return null;
    return token.accessToken;
  }

  setToken(companyId: string, environment: HaciendaEnvironment, token: HaciendaTokenResult): void {
    this.store.set(this.key(companyId, environment), {
      accessToken: token.accessToken,
      expiresAt: token.expiresAt,
    });
  }

  invalidate(companyId: string, environment: HaciendaEnvironment): void {
    this.store.delete(this.key(companyId, environment));
  }

  invalidateAll(): void {
    this.store.clear();
  }
  private key(companyId: string, environment: HaciendaEnvironment): string {
    return `${companyId}:${environment}`;
  }
}
