export class EconomicActivityCode {
  private constructor(readonly value: string) {}

  static create(value: string): EconomicActivityCode {
    const normalized = value.trim();
    if (!/^\d{6}$/.test(normalized)) {
      throw new Error('INVALID_ECONOMIC_ACTIVITY_CODE');
    }
    return new EconomicActivityCode(normalized);
  }
}
