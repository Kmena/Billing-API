import { DomainException } from '../../../shared/domain/domain-exception';

export class CompanyNotFoundException extends DomainException {
  readonly code = 'COMPANY_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(id: string) {
    super(`Company with id '${id}' was not found or does not belong to your tenant.`);
  }
}
