import { DomainException } from '../../../shared/domain/domain-exception';

// Generic 401 — never reveal whether email exists or password is wrong
export class InvalidCredentialsException extends DomainException {
  readonly code = 'INVALID_CREDENTIALS';
  readonly httpStatus = 401;

  constructor() {
    super('Invalid email or password.');
  }
}
