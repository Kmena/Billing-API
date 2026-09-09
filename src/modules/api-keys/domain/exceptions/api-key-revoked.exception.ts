import { DomainException } from '../../../shared/domain/domain-exception';

export class ApiKeyRevokedException extends DomainException {
  readonly code = 'API_KEY_REVOKED';
  readonly httpStatus = 401;

  constructor() {
    super('The API key has been revoked.');
  }
}
