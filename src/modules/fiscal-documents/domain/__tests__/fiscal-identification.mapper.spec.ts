import {
  mapIdentificationTypeToXmlCode,
  normalizeIssuerIdentificationForClave,
} from '../fiscal-identification.mapper';

describe('Fiscal identification mapping', () => {
  it('maps supported domain identification types to Hacienda XML catalog codes explicitly', () => {
    expect(mapIdentificationTypeToXmlCode('FISICA')).toBe('01');
    expect(mapIdentificationTypeToXmlCode('JURIDICA')).toBe('02');
    expect(mapIdentificationTypeToXmlCode('DIMEX')).toBe('03');
    expect(mapIdentificationTypeToXmlCode('NITE')).toBe('04');
  });

  it('preserves already-explicit Hacienda XML catalog codes for supported Costa Rican ID types', () => {
    expect(mapIdentificationTypeToXmlCode('01')).toBe('01');
    expect(mapIdentificationTypeToXmlCode('02')).toBe('02');
    expect(mapIdentificationTypeToXmlCode('03')).toBe('03');
    expect(mapIdentificationTypeToXmlCode('04')).toBe('04');
  });

  it('rejects unsupported identification categories instead of inferring from length', () => {
    expect(() => mapIdentificationTypeToXmlCode('05')).toThrow(
      'FISCAL_IDENTIFICATION_TYPE_UNSUPPORTED',
    );
    expect(() => mapIdentificationTypeToXmlCode('EXTRANJERO_NO_DOMICILIADO')).toThrow(
      'FISCAL_IDENTIFICATION_TYPE_UNSUPPORTED',
    );
  });

  it('normalizes issuer numeric identification for Clave without silently stripping characters', () => {
    expect(normalizeIssuerIdentificationForClave('3101123456')).toBe('003101123456');
    expect(normalizeIssuerIdentificationForClave('123456789012')).toBe('123456789012');
    expect(() => normalizeIssuerIdentificationForClave('3-101-123456')).toThrow(
      'FISCAL_IDENTIFICATION_NUMBER_INVALID_FOR_CLAVE',
    );
    expect(() => normalizeIssuerIdentificationForClave('ABC123456789')).toThrow(
      'FISCAL_IDENTIFICATION_NUMBER_INVALID_FOR_CLAVE',
    );
  });
});
