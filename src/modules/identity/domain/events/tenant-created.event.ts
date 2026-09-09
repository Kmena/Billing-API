import { DomainEvent } from '../../../shared/domain/domain-event';

export class TenantCreatedEvent extends DomainEvent {
  constructor(
    public readonly tenantId: string,
    public readonly slug: string,
    correlationId?: string,
  ) {
    super(correlationId);
  }

  get eventName(): string {
    return 'tenant.created';
  }
}
