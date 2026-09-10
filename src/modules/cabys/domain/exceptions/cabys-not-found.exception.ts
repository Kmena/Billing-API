import { DomainException } from '../../../../modules/shared/domain/domain-exception';

export class CabysItemNotFoundException extends DomainException {
  readonly code = 'CABYS_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(code: string) {
    super(`CABYS item with code '${code}' was not found.`);
  }
}
