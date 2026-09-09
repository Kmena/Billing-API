import { DomainException } from '../../../shared/domain/domain-exception';

export class CompanyAlreadyExistsException extends DomainException {
  readonly code = 'COMPANY_ALREADY_EXISTS';
  readonly httpStatus = 409;

  constructor(identificationNumber: string) {
    super(
      `A company with identification number '${identificationNumber}' already exists in this tenant.`,
    );
  }
}
