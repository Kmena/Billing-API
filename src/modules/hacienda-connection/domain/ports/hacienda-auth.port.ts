import type { HaciendaEnvironment } from '../entities/hacienda-connection.entity';
export interface HaciendaCredentials {
  readonly username: string;
  readonly password: string;
}
export interface HaciendaTokenResult {
  readonly accessToken: string;
  readonly expiresAt: Date;
  readonly refreshToken?: string;
}
export interface HaciendaConnectionValidationResult {
  readonly isValid: boolean;
  readonly token?: HaciendaTokenResult;
  readonly errorCode?: 'INVALID_CREDENTIALS' | 'IDP_UNAVAILABLE' | 'UNKNOWN';
}
export interface HaciendaAuthPort {
  authenticate(
    credentials: HaciendaCredentials,
    environment: HaciendaEnvironment,
  ): Promise<HaciendaTokenResult>;
  validateConnection(
    credentials: HaciendaCredentials,
    environment: HaciendaEnvironment,
  ): Promise<HaciendaConnectionValidationResult>;
}
export const HACIENDA_AUTH_PORT = Symbol('HaciendaAuthPort');
