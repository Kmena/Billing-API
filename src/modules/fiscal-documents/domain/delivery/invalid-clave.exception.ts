import { DomainException } from '../../../shared/domain/domain-exception';

/**
 * Thrown when a Clave value does not match the required 50-digit format (\d{50}).
 * Used by QrContentBuilderPort adapters and any domain logic that validates Clave.
 */
export class InvalidClaveException extends DomainException {
  readonly code = 'INVALID_CLAVE';
  readonly httpStatus = 422;

  constructor(clave: string) {
    super(
      `Clave '${clave.substring(0, 10)}...' is invalid. A valid Clave must be exactly 50 numeric digits (\\d{50}).`,
    );
  }
}
