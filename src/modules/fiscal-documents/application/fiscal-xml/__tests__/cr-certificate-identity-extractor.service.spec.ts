import * as forgeMod from 'node-forge';
import { CrCertificateIdentityExtractorService } from '../cr-certificate-identity-extractor.service';
import {
  FiscalCertificateInvalidFormatException,
  FiscalCertificateIdentityUnreadableException,
  FiscalCertificatePinInvalidException,
  FiscalCertificatePrivateKeyMissingException,
} from '../../../domain/fiscal-xml/exceptions/fiscal-certificate.exceptions';
import { createTestSigningMaterialWithFiscalId } from '../../../domain/fiscal-xml/__tests__/fiscal-xml-test-fixtures';

describe('CrCertificateIdentityExtractorService', () => {
  let service: CrCertificateIdentityExtractorService;

  beforeEach(() => {
    service = new CrCertificateIdentityExtractorService();
  });

  // ── Happy path tests ─────────────────────────────────────────────────────────

  it('extracts and normalizes CPJ- fiscal identity', () => {
    const { pkcs12Bytes, passphrase } = createTestSigningMaterialWithFiscalId('CPJ-3102123456');
    const result = service.extractAndValidate(pkcs12Bytes, passphrase);

    expect(result.extractedIdentityNumber).toBe('3102123456');
    expect(result.extractedIdentityType).toBe('02');
    expect(result.fingerprintSha256).toHaveLength(64);
    expect(result.x509SerialNumber).toBeDefined();
    expect(result.subjectName).toContain('3102123456');
    expect(result.issuerName).toContain('CR Test Hacienda CA');
    expect(result.validFrom).toBeInstanceOf(Date);
    expect(result.validTo).toBeInstanceOf(Date);
  });

  it('extracts and normalizes CF- fiscal identity (FISICA)', () => {
    const { pkcs12Bytes, passphrase } = createTestSigningMaterialWithFiscalId('CF-501234567');
    const result = service.extractAndValidate(pkcs12Bytes, passphrase);

    expect(result.extractedIdentityNumber).toBe('501234567');
    expect(result.extractedIdentityType).toBe('01');
  });

  it('extracts and normalizes DIMEX- fiscal identity', () => {
    const { pkcs12Bytes, passphrase } = createTestSigningMaterialWithFiscalId('DIMEX-800123456');
    const result = service.extractAndValidate(pkcs12Bytes, passphrase);

    expect(result.extractedIdentityNumber).toBe('800123456');
    expect(result.extractedIdentityType).toBe('03');
  });

  it('extracts identity with no prefix — type is null', () => {
    const { pkcs12Bytes, passphrase } = createTestSigningMaterialWithFiscalId('3102123456');
    const result = service.extractAndValidate(pkcs12Bytes, passphrase);

    expect(result.extractedIdentityNumber).toBe('3102123456');
    expect(result.extractedIdentityType).toBeNull();
  });

  it('extracts PE- prefixed identity — type is null', () => {
    const { pkcs12Bytes, passphrase } = createTestSigningMaterialWithFiscalId('PE-12345678');
    const result = service.extractAndValidate(pkcs12Bytes, passphrase);

    expect(result.extractedIdentityNumber).toBe('12345678');
    expect(result.extractedIdentityType).toBeNull();
  });

  // ── Error cases ──────────────────────────────────────────────────────────────

  it('throws SIGNING_CERTIFICATE_PIN_INVALID when wrong PIN supplied', () => {
    const { pkcs12Bytes } = createTestSigningMaterialWithFiscalId('CPJ-3102123456', 'correct-pin');

    let caught: unknown;
    try {
      service.extractAndValidate(pkcs12Bytes, 'wrong-pin');
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(FiscalCertificatePinInvalidException);
    const err = caught as FiscalCertificatePinInvalidException;
    expect(err.code).toBe('SIGNING_CERTIFICATE_PIN_INVALID');
    // Verify the wrong PIN does NOT appear in the error message
    expect(err.message).not.toContain('wrong-pin');
    expect(err.message).not.toContain('correct-pin');
  });

  it('throws FISCAL_CERTIFICATE_INVALID_FORMAT for non-PKCS#12 bytes', () => {
    const garbage = Buffer.from('this is not a pkcs12 file at all -- garbage');

    let caught: unknown;
    try {
      service.extractAndValidate(garbage, 'any-pin');
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(FiscalCertificateInvalidFormatException);
    const err = caught as FiscalCertificateInvalidFormatException;
    expect(err.code).toBe('FISCAL_CERTIFICATE_INVALID_FORMAT');
    // Verify raw bytes do NOT appear in the message
    expect(err.message).not.toContain('this is not');
  });

  it('throws SIGNING_CERTIFICATE_IDENTITY_UNREADABLE when OID 2.5.4.5 is absent', () => {
    // createTestSigningMaterial creates a cert without OID 2.5.4.5
    const {
      createTestSigningMaterial,
    }: typeof import('../../../domain/fiscal-xml/__tests__/fiscal-xml-test-fixtures') =
      jest.requireActual('../../../domain/fiscal-xml/__tests__/fiscal-xml-test-fixtures');
    const material = createTestSigningMaterial('test-pass');

    let caught: unknown;
    try {
      service.extractAndValidate(Buffer.from(material.pkcs12Base64, 'base64'), 'test-pass');
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(FiscalCertificateIdentityUnreadableException);
    expect((caught as FiscalCertificateIdentityUnreadableException).code).toBe(
      'SIGNING_CERTIFICATE_IDENTITY_UNREADABLE',
    );
  });

  it('throws SIGNING_PRIVATE_KEY_MISSING when PKCS#12 has no private key', () => {
    // Spy on node-forge to simulate a PKCS#12 that has no private key bags.
    const { pkcs12Bytes, passphrase } = createTestSigningMaterialWithFiscalId('CPJ-3102123456');

    // Spy on pkcs12.pkcs12FromAsn1 to return an object with no key bags
    const originalFromAsn1 = forgeMod.pkcs12.pkcs12FromAsn1.bind(forgeMod.pkcs12);
    const spyFromAsn1 = jest
      .spyOn(forgeMod.pkcs12, 'pkcs12FromAsn1')
      .mockImplementationOnce((...args) => {
        const pfx = originalFromAsn1(...args);
        const originalGetBags = pfx.getBags.bind(pfx);
        pfx.getBags = (opts: Parameters<typeof pfx.getBags>[0]) => {
          const result = originalGetBags(opts);
          if (opts.bagType === forgeMod.pki.oids.pkcs8ShroudedKeyBag) {
            return { [forgeMod.pki.oids.pkcs8ShroudedKeyBag]: [] };
          }
          if (opts.bagType === forgeMod.pki.oids.keyBag) {
            return { [forgeMod.pki.oids.keyBag]: [] };
          }
          return result;
        };
        return pfx;
      });

    let caught: unknown;
    try {
      service.extractAndValidate(pkcs12Bytes, passphrase);
    } catch (e) {
      caught = e;
    }

    spyFromAsn1.mockRestore();

    expect(caught).toBeInstanceOf(FiscalCertificatePrivateKeyMissingException);
    expect((caught as FiscalCertificatePrivateKeyMissingException).code).toBe(
      'SIGNING_PRIVATE_KEY_MISSING',
    );
  });

  // ── Security: no PIN in error messages ──────────────────────────────────────

  it('never includes the PIN in any error message for bad-PIN scenario', () => {
    const sentinelPin = 'SENTINEL_PIN_VALUE_12345';
    const { pkcs12Bytes } = createTestSigningMaterialWithFiscalId('CPJ-3102123456', 'correct-pin');

    let caught: unknown;
    try {
      service.extractAndValidate(pkcs12Bytes, sentinelPin);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeDefined();
    const err = caught as Error;
    expect(err.message).not.toContain(sentinelPin);
    expect(err.stack ?? '').not.toContain(sentinelPin);
  });

  it('never includes raw PKCS#12 bytes in any error message', () => {
    const garbage = Buffer.from('SENTINEL_BYTES_12345_DO_NOT_LOG');

    let caught: unknown;
    try {
      service.extractAndValidate(garbage, 'any-pin');
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeDefined();
    const err = caught as Error;
    expect(err.message).not.toContain('SENTINEL_BYTES_12345_DO_NOT_LOG');
    expect(err.message).not.toContain(garbage.toString('base64'));
  });
});
