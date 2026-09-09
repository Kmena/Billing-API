import { DomainException } from '../../../shared/domain/domain-exception';

export class UserNotFoundException extends DomainException {
  readonly code = 'USER_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(id: string) {
    super(`User with id '${id}' was not found.`);
  }
}
