import { DomainException } from '../../../shared/domain/domain-exception';

/** Taxpayer not found in Hacienda /fe/ae (body.code === 404). */
export class TaxpayerNotFoundException extends DomainException {
  readonly code = 'TAXPAYER_NOT_FOUND';
  readonly httpStatus = 422;
  constructor(identification: string) {
    super(`Taxpayer ${identification} not found in Hacienda registry.`);
  }
}

/** Hacienda returned a taxpayer but the canonical identification does not match Company. */
export class TaxpayerIdentityMismatchException extends DomainException {
  readonly code = 'TAXPAYER_IDENTITY_MISMATCH';
  readonly httpStatus = 422;
  constructor(expected: string, returned: string) {
    super(`Taxpayer identity mismatch: expected ${expected}, Hacienda returned ${returned}.`);
  }
}

/** Hacienda /fe/ae was temporarily unavailable. Prior persisted data is preserved. */
export class TaxpayerLookupUnavailableException extends DomainException {
  readonly code = 'TAXPAYER_LOOKUP_UNAVAILABLE';
  readonly httpStatus = 503;
  constructor() {
    super('Hacienda taxpayer lookup is temporarily unavailable. Please retry later.');
  }
}

/** Activity code does not belong to the Company or is not verified. */
export class ActivityNotFoundException extends DomainException {
  readonly code = 'ECONOMIC_ACTIVITY_NOT_FOUND';
  readonly httpStatus = 404;
  constructor(code: string) {
    super(`Economic activity ${code} is not registered for this Company.`);
  }
}

/** Attempted to set an activity as default that is not valid for Billing. */
export class DefaultActivityInvalidException extends DomainException {
  readonly code = 'DEFAULT_ACTIVITY_INVALID';
  readonly httpStatus = 422;
  constructor(reason: string) {
    super(`Cannot set default activity: ${reason}`);
  }
}
