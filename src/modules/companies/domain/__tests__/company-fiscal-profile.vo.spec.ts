import { EconomicActivityCode } from '../value-objects/economic-activity-code.vo';
import { FiscalAddress } from '../value-objects/fiscal-address.vo';
import { FiscalContact } from '../value-objects/fiscal-contact.vo';

describe('Company fiscal profile value objects', () => {
  it('accepts official issuer fiscal profile values', () => {
    expect(EconomicActivityCode.create('620210').value).toBe('620210');
    // Hacienda /fe/ae API returns decimal-notation codes like "9609.0" — 6 chars with a dot.
    // These must be stored verbatim; zero-padding to "009609" is INCORRECT.
    expect(EconomicActivityCode.create('9609.0').value).toBe('9609.0');
    expect(
      FiscalAddress.create({
        province: '1',
        canton: '01',
        district: '01',
        barrio: 'Carmen',
        otrasSenas: 'Avenida central, edificio fiscal',
      }).props,
    ).toEqual({
      province: '1',
      canton: '01',
      district: '01',
      barrio: 'Carmen',
      otrasSenas: 'Avenida central, edificio fiscal',
    });
    expect(
      FiscalContact.create({
        email: 'facturacion@example.co.cr',
        phoneCountryCode: '506',
        phoneNumber: '22223333',
      }).props,
    ).toEqual({
      email: 'facturacion@example.co.cr',
      phoneCountryCode: '506',
      phoneNumber: '22223333',
    });
  });

  it('rejects missing or malformed required profile values', () => {
    expect(() => EconomicActivityCode.create('00000')).toThrow('INVALID_ECONOMIC_ACTIVITY_CODE');
    expect(() => FiscalContact.create({ email: 'invalid-email' })).toThrow(
      'INVALID_FISCAL_CONTACT_EMAIL',
    );
  });

  it('enforces Hacienda v4.4 structured address codes and required details', () => {
    expect(() =>
      FiscalAddress.create({
        province: '0',
        canton: '01',
        district: '01',
        otrasSenas: 'Avenida central',
      }),
    ).toThrow('INVALID_FISCAL_ADDRESS_PROVINCE');
    expect(() =>
      FiscalAddress.create({
        province: '1',
        canton: '00',
        district: '01',
        otrasSenas: 'Avenida central',
      }),
    ).toThrow('INVALID_FISCAL_ADDRESS_CANTON');
    expect(() =>
      FiscalAddress.create({
        province: '1',
        canton: '01',
        district: '00',
        otrasSenas: 'Avenida central',
      }),
    ).toThrow('INVALID_FISCAL_ADDRESS_DISTRICT');
    expect(() =>
      FiscalAddress.create({
        province: '1',
        canton: '01',
        district: '01',
        otrasSenas: 'abc',
      }),
    ).toThrow('INVALID_FISCAL_ADDRESS_OTRAS_SENAS');
    expect(() =>
      FiscalAddress.create({
        province: undefined as unknown as string,
        canton: '01',
        district: '01',
        otrasSenas: 'Avenida central',
      }),
    ).toThrow('INVALID_FISCAL_ADDRESS_PROVINCE');
    expect(() =>
      FiscalAddress.create({
        province: '1',
        canton: undefined as unknown as string,
        district: '01',
        otrasSenas: 'Avenida central',
      }),
    ).toThrow('INVALID_FISCAL_ADDRESS_CANTON');
    expect(() =>
      FiscalAddress.create({
        province: '1',
        canton: '01',
        district: undefined as unknown as string,
        otrasSenas: 'Avenida central',
      }),
    ).toThrow('INVALID_FISCAL_ADDRESS_DISTRICT');
    expect(() =>
      FiscalAddress.create({
        province: '1',
        canton: '01',
        district: '01',
        otrasSenas: undefined as unknown as string,
      }),
    ).toThrow('INVALID_FISCAL_ADDRESS_OTRAS_SENAS');
  });

  it('requires complete phone data when issuer phone is provided', () => {
    expect(() =>
      FiscalContact.create({ email: 'facturacion@example.co.cr', phoneCountryCode: '506' }),
    ).toThrow('INVALID_FISCAL_CONTACT_PHONE');
    expect(() =>
      FiscalContact.create({ email: 'facturacion@example.co.cr', phoneNumber: '22223333' }),
    ).toThrow('INVALID_FISCAL_CONTACT_PHONE');
  });
});
