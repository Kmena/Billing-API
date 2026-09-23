import { classifyCabys } from '../fiscal-cabys-classifier';

/**
 * CAByS classifier — unit tests.
 *
 * Classification rule (first digit of 13-digit code):
 *   0–4 → GOODS   (bienes / mercancías)
 *   5–9 → SERVICE (servicios)
 *
 * Source: Hacienda v4.4 CAByS taxonomy; verified against the official catalog
 * at https://api.hacienda.go.cr/fe/cabys
 */
describe('classifyCabys', () => {
  describe('GOODS (first digit 0–4)', () => {
    it.each([
      ['0000000000000', '0'],
      ['1234567890123', '1'],
      ['2000000000000', '2'],
      ['3858200000000', '3 — Cartuchos de software para consolas de videojuegos'],
      ['4782900000000', '4 — Paquete de software de otras aplicaciones'],
    ])('classifies code %s (first digit %s) as GOODS', (code) => {
      expect(classifyCabys(code)).toBe('GOODS');
    });
  });

  describe('SERVICE (first digit 5–9)', () => {
    it.each([
      ['5431000000000', '5 — Servicios de demolición'],
      ['6000000000000', '6'],
      ['7159900009900', '7 — Servicios auxiliares financieros'],
      ['8313100000100', '8 — Servicios de consultoría en software'],
      ['9731000000000', '9 — Servicios de mantenimiento de cementerios'],
    ])('classifies code %s (first digit %s) as SERVICE', (code) => {
      expect(classifyCabys(code)).toBe('SERVICE');
    });
  });

  describe('validation — fails closed', () => {
    it.each([
      [''],
      ['123456789012'],
      ['12345678901234'],
      ['123456789012a'],
      ['1234567890.23'],
      [' 1234567890123'],
    ])('throws INVALID_CABYS_CODE for %j', (code) => {
      expect(() => classifyCabys(code)).toThrow('INVALID_CABYS_CODE');
    });
  });
});
