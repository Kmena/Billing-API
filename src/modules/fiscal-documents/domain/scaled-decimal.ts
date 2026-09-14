export class ScaledDecimal {
  private static readonly SCALE = 5n;
  private static readonly FACTOR = 100000n;

  private constructor(private readonly units: bigint) {}

  static zero(): ScaledDecimal {
    return new ScaledDecimal(0n);
  }

  static from(value: string): ScaledDecimal {
    if (!/^-?\d+(\.\d{1,5})?$/.test(value)) {
      throw new Error('Decimal values must contain at most 5 decimal places.');
    }
    const [whole, fractional = ''] = value.split('.');
    const sign = whole.startsWith('-') ? -1n : 1n;
    const absoluteWhole = whole.replace('-', '');
    const paddedFractional = fractional.padEnd(Number(this.SCALE), '0');
    return new ScaledDecimal(
      sign * (BigInt(absoluteWhole) * this.FACTOR + BigInt(paddedFractional)),
    );
  }

  add(other: ScaledDecimal): ScaledDecimal {
    return new ScaledDecimal(this.units + other.units);
  }

  subtract(other: ScaledDecimal): ScaledDecimal {
    return new ScaledDecimal(this.units - other.units);
  }

  multiply(other: ScaledDecimal): ScaledDecimal {
    return new ScaledDecimal(
      (this.units * other.units + ScaledDecimal.FACTOR / 2n) / ScaledDecimal.FACTOR,
    );
  }

  isNegative(): boolean {
    return this.units < 0n;
  }

  toString(): string {
    const sign = this.units < 0n ? '-' : '';
    const absolute = this.units < 0n ? -this.units : this.units;
    const whole = absolute / ScaledDecimal.FACTOR;
    const fractional = (absolute % ScaledDecimal.FACTOR)
      .toString()
      .padStart(Number(ScaledDecimal.SCALE), '0');
    return `${sign}${whole.toString()}.${fractional}`;
  }
}
