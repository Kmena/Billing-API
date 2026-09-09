export abstract class DomainEvent {
  readonly occurredAt: Date;
  readonly correlationId?: string;

  constructor(correlationId?: string) {
    this.occurredAt = new Date();
    this.correlationId = correlationId;
  }

  abstract get eventName(): string;
}
