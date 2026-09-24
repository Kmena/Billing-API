export class EconomicActivityCode {
  private constructor(readonly value: string) {}

  /**
   * Accepts economic activity codes exactly as Hacienda's /fe/ae API returns them.
   * Two known formats (both exactly 6 characters, per XSD minLength/maxLength=6):
   *   - "620210"  – six plain digits (CIIU-style full code)
   *   - "9609.0"  – four digits, dot, one digit (Hacienda decimal notation)
   *
   * The value is stored verbatim — no zero-padding, no parseFloat, no numeric
   * coercion.  Treat it as an opaque 6-character string.
   */
  static create(value: string): EconomicActivityCode {
    const normalized = value.trim();
    if (normalized.length !== 6 || !/^[\d.]+$/.test(normalized)) {
      throw new Error('INVALID_ECONOMIC_ACTIVITY_CODE');
    }
    return new EconomicActivityCode(normalized);
  }
}
