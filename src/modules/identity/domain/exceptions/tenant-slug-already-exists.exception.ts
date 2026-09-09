import { DomainException } from '../../../shared/domain/domain-exception';

export class TenantSlugAlreadyExistsException extends DomainException {
  readonly code = 'TENANT_SLUG_ALREADY_EXISTS';
  readonly httpStatus = 409;

  constructor(slug: string) {
    super(`A tenant with slug '${slug}' already exists.`);
  }
}
