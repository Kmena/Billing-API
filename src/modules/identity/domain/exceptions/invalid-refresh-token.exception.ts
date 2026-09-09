import { DomainException } from '../../../shared/domain/domain-exception';

export class InvalidRefreshTokenException extends DomainException {
  readonly code = 'INVALID_REFRESH_TOKEN';
  readonly httpStatus = 401;

  constructor() {
    super('The refresh token is invalid, expired, or has already been used.');
  }
}
