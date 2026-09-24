import { ScaledDecimal } from '../scaled-decimal';

describe('ScaledDecimal', () => {
  it('preserves five decimal places for fiscal arithmetic', () => {
    const total = ScaledDecimal.from('2.50000').multiply(ScaledDecimal.from('3.33333'));
    expect(total.toString()).toBe('8.33333');
  });

  it('rejects values with more than five decimal places', () => {
    expect(() => ScaledDecimal.from('1.123456')).toThrow('at most 5 decimal places');
  });

  it('isZero returns true only for the zero value', () => {
    expect(ScaledDecimal.zero().isZero()).toBe(true);
    expect(ScaledDecimal.from('0.00000').isZero()).toBe(true);
    expect(ScaledDecimal.from('0.00001').isZero()).toBe(false);
    expect(ScaledDecimal.from('1.00000').isZero()).toBe(false);
  });
});
