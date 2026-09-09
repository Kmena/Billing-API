import { DomainException } from '../../../shared/domain/domain-exception';

export class ApiKeyInvalidException extends DomainException {
  readonly code = 'API_KEY_INVALID';
  readonly httpStatus = 401;

  constructor() {
    super('The API key provided is invalid.');
  }
}
