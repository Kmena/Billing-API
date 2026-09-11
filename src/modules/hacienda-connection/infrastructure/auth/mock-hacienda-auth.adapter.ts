import { Injectable } from '@nestjs/common';
import type { HaciendaEnvironment } from '../../domain/entities/hacienda-connection.entity';
import type {
  HaciendaAuthPort,
  HaciendaConnectionValidationResult,
  HaciendaCredentials,
  HaciendaTokenResult,
} from '../../domain/ports/hacienda-auth.port';

export type MockHaciendaAuthBehavior = 'SUCCESS' | 'INVALID_CREDENTIALS' | 'UNAVAILABLE';

@Injectable()
export class MockHaciendaAuthAdapter implements HaciendaAuthPort {
  behavior: MockHaciendaAuthBehavior = 'SUCCESS';

  async authenticate(
    _credentials: HaciendaCredentials,
    _environment: HaciendaEnvironment,
  ): Promise<HaciendaTokenResult> {
    if (this.behavior === 'INVALID_CREDENTIALS') throw new Error('Invalid Hacienda credentials');
    if (this.behavior === 'UNAVAILABLE') throw new Error('Hacienda IDP unavailable');
    return { accessToken: 'mock-hacienda-access-token', expiresAt: new Date(Date.now() + 300000) };
  }

  async validateConnection(
    credentials: HaciendaCredentials,
    environment: HaciendaEnvironment,
  ): Promise<HaciendaConnectionValidationResult> {
    if (this.behavior === 'INVALID_CREDENTIALS')
      return { isValid: false, errorCode: 'INVALID_CREDENTIALS' };
    if (this.behavior === 'UNAVAILABLE') return { isValid: false, errorCode: 'IDP_UNAVAILABLE' };
    return { isValid: true, token: await this.authenticate(credentials, environment) };
  }
}
