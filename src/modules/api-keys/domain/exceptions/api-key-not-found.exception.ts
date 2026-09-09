import { DomainException } from '../../../shared/domain/domain-exception';

export class ApiKeyNotFoundException extends DomainException {
  readonly code = 'API_KEY_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(id: string) {
    super(`API key with id '${id}' was not found or does not belong to your tenant.`);
  }
}
