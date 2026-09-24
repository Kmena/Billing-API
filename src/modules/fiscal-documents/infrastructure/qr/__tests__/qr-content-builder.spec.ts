import { MockQrContentBuilderAdapter, MOCK_QR_BASE } from '../mock-qr-content-builder.adapter';
import { HaciendaQrContentBuilderAdapter } from '../hacienda-qr-content-builder.adapter';
import { InvalidClaveException } from '../../../domain/delivery/invalid-clave.exception';

// Test vectors from pdf-rendering-contract.md
const VALID_CLAVE_50 = '12345678901234567890123456789012345678901234567890';
const VALID_CLAVE_FE = '00606010000310000100001010000000001234567890123456'; // illustrative FE clave shape
const VALID_CLAVE_TE = '00601010000310000200001010000000001234567890123456'; // illustrative TE clave shape
const CLAVE_49 = '1234567890123456789012345678901234567890123456789'; // 49 digits
const CLAVE_51 = '123456789012345678901234567890123456789012345678901'; // 51 digits
const CLAVE_NON_DIGIT = '1234567890abcdef678901234567890123456789012345678'; // 48 chars with non-digit

describe('MockQrContentBuilderAdapter', () => {
  const adapter = new MockQrContentBuilderAdapter();

  describe('valid 50-digit claves', () => {
    it('returns deterministic output for valid 50-digit clave', () => {
      const result = adapter.buildQrContent(VALID_CLAVE_50);
      expect(result).toBe(`${MOCK_QR_BASE}?Clave=${VALID_CLAVE_50}`);
    });

    it('contains exact immutable clave in output', () => {
      const result = adapter.buildQrContent(VALID_CLAVE_50);
      expect(result).toContain(VALID_CLAVE_50);
    });

    it('uses configured mock base', () => {
      const result = adapter.buildQrContent(VALID_CLAVE_50);
      expect(result.startsWith(MOCK_QR_BASE)).toBe(true);
    });

    it('FE clave produces correct output', () => {
      const result = adapter.buildQrContent(VALID_CLAVE_FE);
      expect(result).toBe(`${MOCK_QR_BASE}?Clave=${VALID_CLAVE_FE}`);
    });

    it('TE clave produces correct output', () => {
      const result = adapter.buildQrContent(VALID_CLAVE_TE);
      expect(result).toBe(`${MOCK_QR_BASE}?Clave=${VALID_CLAVE_TE}`);
    });

    it('output does not contain internal identifiers or secrets', () => {
      const result = adapter.buildQrContent(VALID_CLAVE_50);
      // Must not contain tenant/company IDs, storage keys, tokens
      expect(result).not.toMatch(/tenant/i);
      expect(result).not.toMatch(/company/i);
      expect(result).not.toMatch(/secret/i);
      expect(result).not.toMatch(/token/i);
      expect(result).not.toMatch(/key/i);
    });
  });

  describe('invalid clave rejection', () => {
    it('throws InvalidClaveException for 49-digit clave', () => {
      expect(() => adapter.buildQrContent(CLAVE_49)).toThrow(InvalidClaveException);
    });

    it('throws InvalidClaveException for 51-digit clave', () => {
      expect(() => adapter.buildQrContent(CLAVE_51)).toThrow(InvalidClaveException);
    });

    it('throws InvalidClaveException for clave with non-digit chars', () => {
      expect(() => adapter.buildQrContent(CLAVE_NON_DIGIT)).toThrow(InvalidClaveException);
    });

    it('throws InvalidClaveException for empty string', () => {
      expect(() => adapter.buildQrContent('')).toThrow(InvalidClaveException);
    });

    it('throws InvalidClaveException for whitespace-padded clave', () => {
      expect(() => adapter.buildQrContent(' ' + VALID_CLAVE_50.substring(0, 49))).toThrow(
        InvalidClaveException,
      );
    });
  });
});

describe('HaciendaQrContentBuilderAdapter', () => {
  describe('constructor validation', () => {
    it('throws on empty URL base (missing production config)', () => {
      expect(() => new HaciendaQrContentBuilderAdapter('')).toThrow();
    });

    it('throws on whitespace-only URL base', () => {
      expect(() => new HaciendaQrContentBuilderAdapter('   ')).toThrow();
    });

    it('constructs successfully with valid URL base', () => {
      expect(
        () => new HaciendaQrContentBuilderAdapter('https://production.hacienda.go.cr/ce/qr'),
      ).not.toThrow();
    });
  });

  describe('buildQrContent', () => {
    const BASE = 'https://configured-hacienda-base.example.com/qr';
    const adapter = new HaciendaQrContentBuilderAdapter(BASE);

    it('output = configured base + ?Clave= + clave', () => {
      const result = adapter.buildQrContent(VALID_CLAVE_50);
      expect(result).toBe(`${BASE}?Clave=${VALID_CLAVE_50}`);
    });

    it('uses the operator-configured URL base (not a hardcoded URL)', () => {
      const customBase = 'https://custom.operator.example.com/hacienda/qr';
      const adapter2 = new HaciendaQrContentBuilderAdapter(customBase);
      const result = adapter2.buildQrContent(VALID_CLAVE_50);
      expect(result.startsWith(customBase)).toBe(true);
    });

    it('throws InvalidClaveException for malformed clave', () => {
      expect(() => adapter.buildQrContent(CLAVE_49)).toThrow(InvalidClaveException);
    });

    it('output contains only Clave as query parameter', () => {
      const result = adapter.buildQrContent(VALID_CLAVE_50);
      const url = new URL(result);
      const params = Array.from(url.searchParams.keys());
      expect(params).toEqual(['Clave']);
      expect(url.searchParams.get('Clave')).toBe(VALID_CLAVE_50);
    });
  });
});
