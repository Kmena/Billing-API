import { ValueObject } from '../value-object';

interface MoneyProps {
  amount: number;
  currency: string;
}

class Money extends ValueObject<MoneyProps> {
  constructor(amount: number, currency: string) {
    super({ amount, currency });
  }

  get amount(): number {
    return this.props.amount;
  }

  get currency(): string {
    return this.props.currency;
  }
}

interface PriceProps {
  amount: number;
  currency: string;
}

class Price extends ValueObject<PriceProps> {
  constructor(amount: number, currency: string) {
    super({ amount, currency });
  }
}

describe('ValueObject', () => {
  describe('equals()', () => {
    it('returns true when two VOs have the same props', () => {
      const a = new Money(100, 'CRC');
      const b = new Money(100, 'CRC');

      expect(a.equals(b)).toBe(true);
    });

    it('returns false when two VOs have different props', () => {
      const a = new Money(100, 'CRC');
      const b = new Money(200, 'CRC');

      expect(a.equals(b)).toBe(false);
    });

    it('returns false when comparing VOs of different types with same props', () => {
      const money = new Money(100, 'USD');
      const price = new Price(100, 'USD');

      // Different constructor types
      expect(money.equals(price as unknown as Money)).toBe(false);
    });

    it('returns false when comparing with null', () => {
      const a = new Money(100, 'CRC');
      expect(a.equals(null as unknown as Money)).toBe(false);
    });

    it('returns false when comparing with undefined', () => {
      const a = new Money(100, 'CRC');
      expect(a.equals(undefined as unknown as Money)).toBe(false);
    });

    it('compares by value, not by reference', () => {
      const a = new Money(50, 'USD');
      const b = new Money(50, 'USD');

      expect(a).not.toBe(b); // Different references
      expect(a.equals(b)).toBe(true); // Same value
    });
  });
});
