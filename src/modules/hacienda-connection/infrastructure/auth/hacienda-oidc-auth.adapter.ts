import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import type { HaciendaEnvironment } from '../../domain/entities/hacienda-connection.entity';
import type {
  HaciendaAuthPort,
  HaciendaConnectionValidationResult,
  HaciendaCredentials,
  HaciendaTokenResult,
} from '../../domain/ports/hacienda-auth.port';
import type { HaciendaAuthConfig } from '../../../../infrastructure/config/hacienda-auth.config';

interface KeycloakTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}

@Injectable()
export class HaciendaOidcAuthAdapter implements HaciendaAuthPort {
  private readonly config: HaciendaAuthConfig;
  constructor(
    private readonly configService: ConfigService,
    private readonly http: HttpService,
  ) {
    this.config = configService.get<HaciendaAuthConfig>('haciendaAuth')!;
  }

  async authenticate(
    credentials: HaciendaCredentials,
    environment: HaciendaEnvironment,
  ): Promise<HaciendaTokenResult> {
    const body = new URLSearchParams({
      grant_type: 'password',
      client_id: this.clientId(environment),
      username: credentials.username,
      password: credentials.password,
    });
    const response = await firstValueFrom(
      this.http.post<KeycloakTokenResponse>(this.url(environment), body.toString(), {
        timeout: this.config.authTimeoutMs,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }),
    );
    return {
      accessToken: response.data.access_token,
      refreshToken: response.data.refresh_token,
      expiresAt: new Date(Date.now() + response.data.expires_in * 1000),
    };
  }

  async validateConnection(
    credentials: HaciendaCredentials,
    environment: HaciendaEnvironment,
  ): Promise<HaciendaConnectionValidationResult> {
    try {
      return { isValid: true, token: await this.authenticate(credentials, environment) };
    } catch (error: unknown) {
      return {
        isValid: false,
        errorCode: this.isUnauthorized(error) ? 'INVALID_CREDENTIALS' : 'IDP_UNAVAILABLE',
      };
    }
  }

  private isUnauthorized(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'response' in error &&
      (error as { response?: { status?: number } }).response?.status === 401
    );
  }

  private url(environment: HaciendaEnvironment): string {
    return environment === 'PRODUCTION'
      ? this.config.idp.productionTokenUrl
      : this.config.idp.sandboxTokenUrl;
  }
  private clientId(environment: HaciendaEnvironment): string {
    return environment === 'PRODUCTION'
      ? this.config.idp.productionClientId
      : this.config.idp.sandboxClientId;
  }
}
