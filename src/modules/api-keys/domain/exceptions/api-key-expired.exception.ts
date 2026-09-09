import { DomainException } from '../../../shared/domain/domain-exception';

export class ApiKeyExpiredException extends DomainException {
  readonly code = 'API_KEY_EXPIRED';
  readonly httpStatus = 401;

  constructor() {
    super('The API key has expired.');
  }
}
