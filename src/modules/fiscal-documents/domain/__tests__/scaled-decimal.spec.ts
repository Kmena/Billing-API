import { ScaledDecimal } from '../scaled-decimal';

describe('ScaledDecimal', () => {
  it('preserves five decimal places for fiscal arithmetic', () => {
    const total = ScaledDecimal.from('2.50000').multiply(ScaledDecimal.from('3.33333'));
    expect(total.toString()).toBe('8.33333');
  });

  it('rejects values with more than five decimal places', () => {
    expect(() => ScaledDecimal.from('1.123456')).toThrow('at most 5 decimal places');
  });
});
