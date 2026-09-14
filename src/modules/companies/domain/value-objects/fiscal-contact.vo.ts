export interface FiscalContactProps {
  readonly email: string;
  readonly phoneCountryCode?: string;
  readonly phoneNumber?: string;
}

export class FiscalContact {
  private constructor(readonly props: FiscalContactProps) {}

  static create(input: FiscalContactProps): FiscalContact {
    const email = input.email.trim();
    const phoneCountryCode = input.phoneCountryCode?.trim();
    const phoneNumber = input.phoneNumber?.trim();

    if (!/^\s*\w+([-+.']\w+)*@\w+([-.]\w+)*\.\w+([-.]\w+)*\s*$/.test(email)) {
      throw new Error('INVALID_FISCAL_CONTACT_EMAIL');
    }
    if (email.length > 160) throw new Error('INVALID_FISCAL_CONTACT_EMAIL');

    if ((phoneCountryCode && !phoneNumber) || (!phoneCountryCode && phoneNumber)) {
      throw new Error('INVALID_FISCAL_CONTACT_PHONE');
    }
    if (phoneCountryCode && !/^\d{1,3}$/.test(phoneCountryCode)) {
      throw new Error('INVALID_FISCAL_CONTACT_PHONE');
    }
    if (phoneNumber && !/^\d{3,20}$/.test(phoneNumber)) {
      throw new Error('INVALID_FISCAL_CONTACT_PHONE');
    }

    return new FiscalContact({ email, phoneCountryCode, phoneNumber });
  }
}
