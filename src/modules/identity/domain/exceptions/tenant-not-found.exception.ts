import { DomainException } from '../../../shared/domain/domain-exception';

export class TenantNotFoundException extends DomainException {
  readonly code = 'TENANT_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(id: string) {
    super(`Tenant with id '${id}' was not found.`);
  }
}
