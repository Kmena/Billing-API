import { DomainException } from '../../../../modules/shared/domain/domain-exception';

/**
 * HaciendaUnavailableException — thrown when Hacienda is unreachable or
 * the circuit breaker is open.
 * Maps to HTTP 503 Service Unavailable (FR-016).
 */
export class HaciendaUnavailableException extends DomainException {
  readonly code = 'HACIENDA_UNAVAILABLE';
  readonly httpStatus = 503;

  constructor(operation: string) {
    super(`Hacienda service is temporarily unavailable. Operation: ${operation}.`);
  }
}
