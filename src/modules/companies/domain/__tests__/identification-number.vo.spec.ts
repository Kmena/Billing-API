import { IdentificationNumber } from '../value-objects/identification-number.vo';

describe('IdentificationNumber VO', () => {
  describe('FISICA (9 digits)', () => {
    it('accepts valid 9-digit cédula física', () => {
      const id = IdentificationNumber.create('123456789', 'FISICA');
      expect(id.value).toBe('123456789');
    });

    it('rejects 8-digit number', () => {
      expect(() => IdentificationNumber.create('12345678', 'FISICA')).toThrow();
    });

    it('rejects 10-digit number', () => {
      expect(() => IdentificationNumber.create('1234567890', 'FISICA')).toThrow();
    });
  });

  describe('JURIDICA (10 digits)', () => {
    it('accepts valid 10-digit cédula jurídica', () => {
      const id = IdentificationNumber.create('3101234567', 'JURIDICA');
      expect(id.value).toBe('3101234567');
    });

    it('rejects 9-digit number', () => {
      expect(() => IdentificationNumber.create('310123456', 'JURIDICA')).toThrow();
    });

    it('rejects 11-digit number', () => {
      expect(() => IdentificationNumber.create('31012345678', 'JURIDICA')).toThrow();
    });
  });

  describe('DIMEX (11-12 digits)', () => {
    it('accepts valid 11-digit DIMEX', () => {
      const id = IdentificationNumber.create('11234567890', 'DIMEX');
      expect(id.value).toBe('11234567890');
    });

    it('accepts valid 12-digit DIMEX', () => {
      const id = IdentificationNumber.create('112345678901', 'DIMEX');
      expect(id.value).toBe('112345678901');
    });

    it('rejects 10-digit number', () => {
      expect(() => IdentificationNumber.create('1123456789', 'DIMEX')).toThrow();
    });

    it('rejects 13-digit number', () => {
      expect(() => IdentificationNumber.create('1123456789012', 'DIMEX')).toThrow();
    });
  });

  describe('NITE (10 digits)', () => {
    it('accepts valid 10-digit NITE', () => {
      const id = IdentificationNumber.create('3001234567', 'NITE');
      expect(id.value).toBe('3001234567');
    });

    it('rejects 9-digit number', () => {
      expect(() => IdentificationNumber.create('300123456', 'NITE')).toThrow();
    });
  });

  describe('common validation', () => {
    it('removes non-digit characters before validation', () => {
      // Accepts with hyphens stripped
      const id = IdentificationNumber.create('123-456-789', 'FISICA');
      expect(id.value).toBe('123456789');
    });

    it('rejects empty string', () => {
      expect(() => IdentificationNumber.create('', 'FISICA')).toThrow();
    });
  });
});
