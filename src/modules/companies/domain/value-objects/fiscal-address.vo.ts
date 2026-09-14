export interface FiscalAddressProps {
  readonly province: string;
  readonly canton: string;
  readonly district: string;
  readonly barrio?: string;
  readonly otrasSenas: string;
}

export class FiscalAddress {
  private constructor(readonly props: FiscalAddressProps) {}

  static create(input: FiscalAddressProps): FiscalAddress {
    const province = this.requireTrimmed(input.province, 'INVALID_FISCAL_ADDRESS_PROVINCE');
    const canton = this.requireTrimmed(input.canton, 'INVALID_FISCAL_ADDRESS_CANTON');
    const district = this.requireTrimmed(input.district, 'INVALID_FISCAL_ADDRESS_DISTRICT');
    const barrio = input.barrio?.trim();
    const otrasSenas = this.requireTrimmed(input.otrasSenas, 'INVALID_FISCAL_ADDRESS_OTRAS_SENAS');

    if (!/^[1-9]$/.test(province)) throw new Error('INVALID_FISCAL_ADDRESS_PROVINCE');
    if (!/^(0[1-9]|[1-9][0-9])$/.test(canton)) {
      throw new Error('INVALID_FISCAL_ADDRESS_CANTON');
    }
    if (!/^(0[1-9]|[1-9][0-9])$/.test(district)) {
      throw new Error('INVALID_FISCAL_ADDRESS_DISTRICT');
    }
    if (barrio !== undefined && (barrio.length < 5 || barrio.length > 50)) {
      throw new Error('INVALID_FISCAL_ADDRESS_BARRIO');
    }
    if (otrasSenas.length < 5 || otrasSenas.length > 250) {
      throw new Error('INVALID_FISCAL_ADDRESS_OTRAS_SENAS');
    }

    return new FiscalAddress({ province, canton, district, barrio, otrasSenas });
  }

  private static requireTrimmed(value: string, errorCode: string): string {
    if (typeof value !== 'string') throw new Error(errorCode);

    const trimmed = value.trim();
    if (trimmed.length === 0) throw new Error(errorCode);

    return trimmed;
  }
}
