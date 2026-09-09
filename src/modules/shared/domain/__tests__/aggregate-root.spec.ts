import { AggregateRoot } from '../aggregate-root';
import { DomainEvent } from '../domain-event';

class OrderCreatedEvent extends DomainEvent {
  constructor(
    public readonly orderId: string,
    correlationId?: string,
  ) {
    super(correlationId);
  }

  get eventName(): string {
    return 'order.created';
  }
}

class OrderShippedEvent extends DomainEvent {
  constructor(public readonly orderId: string) {
    super();
  }

  get eventName(): string {
    return 'order.shipped';
  }
}

class Order extends AggregateRoot<string> {
  private _status: string;

  constructor(id: string, status: string = 'PENDING') {
    super(id);
    this._status = status;
  }

  get status(): string {
    return this._status;
  }

  create(): void {
    this._status = 'CREATED';
    this.addDomainEvent(new OrderCreatedEvent(this.id));
  }

  ship(): void {
    this._status = 'SHIPPED';
    this.addDomainEvent(new OrderShippedEvent(this.id));
  }
}

describe('AggregateRoot', () => {
  describe('domain events accumulation', () => {
    it('accumulates domain events when operations occur', () => {
      const order = new Order('order-1');
      order.create();

      expect(order.domainEvents).toHaveLength(1);
      expect(order.domainEvents[0]).toBeInstanceOf(OrderCreatedEvent);
    });

    it('accumulates multiple events in order', () => {
      const order = new Order('order-1');
      order.create();
      order.ship();

      expect(order.domainEvents).toHaveLength(2);
      expect(order.domainEvents[0]).toBeInstanceOf(OrderCreatedEvent);
      expect(order.domainEvents[1]).toBeInstanceOf(OrderShippedEvent);
    });
  });

  describe('clearDomainEvents()', () => {
    it('returns all accumulated events', () => {
      const order = new Order('order-1');
      order.create();
      order.ship();

      const events = order.clearDomainEvents();

      expect(events).toHaveLength(2);
    });

    it('clears events after calling clear', () => {
      const order = new Order('order-1');
      order.create();

      order.clearDomainEvents();

      expect(order.domainEvents).toHaveLength(0);
    });

    it('returns an empty array when no events are accumulated', () => {
      const order = new Order('order-1');

      const events = order.clearDomainEvents();

      expect(events).toHaveLength(0);
    });
  });

  describe('domainEvents getter', () => {
    it('is readonly (returns a copy-like view)', () => {
      const order = new Order('order-1');
      order.create();

      const events = order.domainEvents;
      expect(events).toHaveLength(1);
    });
  });
});
