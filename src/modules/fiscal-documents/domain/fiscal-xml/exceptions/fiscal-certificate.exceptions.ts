import { DomainException } from '../../../../shared/domain/domain-exception';

export class FiscalCertificatePinInvalidException extends DomainException {
  readonly code = 'SIGNING_CERTIFICATE_PIN_INVALID';
  readonly httpStatus = 422;

  constructor() {
    super('The provided PIN does not unlock the PKCS#12 certificate.');
  }
}

export class FiscalCertificateInvalidFormatException extends DomainException {
  readonly code = 'FISCAL_CERTIFICATE_INVALID_FORMAT';
  readonly httpStatus = 400;

  constructor() {
    super('The uploaded file is not a valid PKCS#12 certificate.');
  }
}

export class FiscalCertificatePrivateKeyMissingException extends DomainException {
  readonly code = 'SIGNING_PRIVATE_KEY_MISSING';
  readonly httpStatus = 422;

  constructor() {
    super('No private key was found inside the PKCS#12 certificate.');
  }
}

export class FiscalCertificateMissingException extends DomainException {
  readonly code = 'SIGNING_CERTIFICATE_MISSING';
  readonly httpStatus = 422;

  constructor() {
    super('No signing certificate was found inside the PKCS#12 file.');
  }
}

export class FiscalCertificateIdentityUnreadableException extends DomainException {
  readonly code = 'SIGNING_CERTIFICATE_IDENTITY_UNREADABLE';
  readonly httpStatus = 422;

  constructor() {
    super(
      'Cannot extract fiscal identity from certificate. OID 2.5.4.5 is absent or unrecognized.',
    );
  }
}

export class FiscalCertificateEmitterMismatchException extends DomainException {
  readonly code = 'FISCAL_CERTIFICATE_EMITTER_MISMATCH';
  readonly httpStatus = 422;

  constructor() {
    super(
      'The certificate identification number does not match the company identification number.',
    );
  }
}

export class FiscalCertificateExpiredException extends DomainException {
  readonly code = 'FISCAL_CERTIFICATE_EXPIRED';
  readonly httpStatus = 422;

  constructor() {
    super('The certificate has expired and cannot be activated.');
  }
}

export class FiscalCertificateNotYetValidException extends DomainException {
  readonly code = 'FISCAL_CERTIFICATE_NOT_YET_VALID';
  readonly httpStatus = 422;

  constructor() {
    super('The certificate is not yet valid (validFrom is in the future).');
  }
}

export class FiscalCertificateFileTooLargeException extends DomainException {
  readonly code = 'FISCAL_CERTIFICATE_FILE_TOO_LARGE';
  readonly httpStatus = 400;

  constructor(maxBytes: number) {
    super(`Certificate file exceeds the maximum allowed size of ${maxBytes} bytes.`);
  }
}

export class FiscalCertificateStorageFailedException extends DomainException {
  readonly code = 'FISCAL_CERTIFICATE_STORAGE_FAILED';
  readonly httpStatus = 500;

  constructor() {
    super('Failed to securely store the certificate. Please try again.');
  }
}

export class FiscalCertificatePersistFailedException extends DomainException {
  readonly code = 'FISCAL_CERTIFICATE_PERSIST_FAILED';
  readonly httpStatus = 500;

  constructor() {
    super('Failed to persist certificate record to database. Please try again.');
  }
}

export class FiscalCertificateIdentityConflictException extends DomainException {
  readonly code = 'FISCAL_CERTIFICATE_IDENTITY_CONFLICT';
  readonly httpStatus = 409;

  constructor() {
    super(
      'This company identity change is incompatible with the currently ACTIVE signing certificate. ' +
        'Resolve the certificate conflict before modifying the company fiscal identity.',
    );
  }
}

export class FiscalCertificateNotFoundForReadException extends DomainException {
  readonly code = 'FISCAL_CERTIFICATE_NOT_FOUND';
  readonly httpStatus = 404;

  constructor() {
    super('No active fiscal signing certificate was found for this company and environment.');
  }
}

/**
 * Thrown when a database-level unique constraint prevents concurrent certificate
 * activation for the same (tenantId, companyId, environment) combination.
 * This is the application-layer representation of a P2002 on
 * fiscal_signing_cert_one_active_per_scope.
 */
export class FiscalCertificateConcurrentActivationException extends DomainException {
  readonly code = 'FISCAL_CERTIFICATE_CONCURRENT_ACTIVATION';
  readonly httpStatus = 409;

  constructor() {
    super(
      'A concurrent certificate activation was detected for this company and environment. ' +
        'Only one ACTIVE certificate is allowed per company/environment. Please retry.',
    );
  }
}
