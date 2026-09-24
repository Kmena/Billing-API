import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import * as forge from 'node-forge';
import {
  FiscalCertificateInvalidFormatException,
  FiscalCertificateMissingException,
  FiscalCertificatePinInvalidException,
  FiscalCertificatePrivateKeyMissingException,
  FiscalCertificateIdentityUnreadableException,
} from '../../domain/fiscal-xml/exceptions/fiscal-certificate.exceptions';

/**
 * Normalized data extracted from a Costa Rica Hacienda PKCS#12 certificate.
 * All fields are safe to log and persist — no secret material is included.
 */
export interface CrCertificateExtractedData {
  /** SHA-256 fingerprint of the raw PKCS#12 bytes (hex). */
  fingerprintSha256: string;
  /** X.509 certificate serial number (hex big-integer string). */
  x509SerialNumber: string;
  /** Full subject DN string. */
  subjectName: string;
  /** Full issuer DN string. */
  issuerName: string;
  validFrom: Date;
  validTo: Date;
  /**
   * Normalized fiscal identification number extracted from OID 2.5.4.5.
   * Prefixes (CPJ-, CF-, DIMEX-, PE-, PN-) are stripped.
   * Example: 'CPJ-3102123456' → '3102123456'
   */
  extractedIdentityNumber: string;
  /**
   * Identification type code derived from OID prefix.
   * 'CF-'    → '01' (FISICA)
   * 'CPJ-'   → '02' (JURIDICA)
   * 'DIMEX-' → '03' (DIMEX)
   * Others / unknown → null
   */
  extractedIdentityType: string | null;
}

/**
 * OID 2.5.4.5 prefix → normalized CR identification type code.
 * Based on Hacienda certificate convention.
 */
const PREFIX_TO_TYPE: Record<string, string> = {
  'CPJ-': '02',
  'CF-': '01',
  'DIMEX-': '03',
};

/**
 * Pure domain service — no I/O, no external dependencies.
 * Accepts PKCS#12 bytes + PIN, validates the certificate and extracts
 * the Costa Rica fiscal identity from OID 2.5.4.5 (serialNumber).
 *
 * All errors are sanitized: no PIN or certificate bytes appear in
 * exception messages or stack traces.
 */
@Injectable()
export class CrCertificateIdentityExtractorService {
  /**
   * Parse and validate a PKCS#12 certificate, extract and normalize the
   * Costa Rica fiscal identification from OID 2.5.4.5.
   *
   * @throws FiscalCertificateInvalidFormatException — cannot parse PKCS#12
   * @throws FiscalCertificatePinInvalidException — PIN does not unlock PKCS#12
   * @throws FiscalCertificatePrivateKeyMissingException — no private key found
   * @throws FiscalCertificateMissingException — no certificate found
   * @throws FiscalCertificateIdentityUnreadableException — OID 2.5.4.5 absent
   */
  extractAndValidate(pkcs12Bytes: Buffer, pin: string): CrCertificateExtractedData {
    const pkcs12 = this.parsePkcs12(pkcs12Bytes, pin);
    const privateKey = this.extractPrivateKey(pkcs12);
    if (!privateKey) {
      throw new FiscalCertificatePrivateKeyMissingException();
    }
    const cert = this.extractLeafCertificate(pkcs12);
    if (!cert) {
      throw new FiscalCertificateMissingException();
    }

    const rawOidValue = this.extractOid2545(cert);
    if (rawOidValue === null) {
      throw new FiscalCertificateIdentityUnreadableException();
    }

    const { extractedIdentityNumber, extractedIdentityType } = this.normalizeOidValue(rawOidValue);

    return {
      fingerprintSha256: createHash('sha256').update(pkcs12Bytes).digest('hex'),
      x509SerialNumber: cert.serialNumber,
      subjectName: this.formatDn(cert.subject.attributes),
      issuerName: this.formatDn(cert.issuer.attributes),
      validFrom: new Date(cert.validity.notBefore),
      validTo: new Date(cert.validity.notAfter),
      extractedIdentityNumber,
      extractedIdentityType,
    };
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private parsePkcs12(pkcs12Bytes: Buffer, pin: string): forge.pkcs12.Pkcs12Pfx {
    let asn1: forge.asn1.Asn1;
    try {
      asn1 = forge.asn1.fromDer(pkcs12Bytes.toString('binary'));
    } catch {
      // Swallow raw forge error — it may contain input bytes
      throw new FiscalCertificateInvalidFormatException();
    }

    try {
      return forge.pkcs12.pkcs12FromAsn1(asn1, false, pin);
    } catch {
      // forge throws when PIN is wrong or structure is broken after ASN.1 parse
      // We can't distinguish wrong-PIN from corrupt structure at this point, but
      // the structure was valid ASN.1, so the most likely cause is a wrong PIN.
      throw new FiscalCertificatePinInvalidException();
    }
  }

  private extractPrivateKey(pkcs12: forge.pkcs12.Pkcs12Pfx): forge.pki.PrivateKey | null {
    try {
      const shroudedBags = pkcs12.getBags({
        bagType: forge.pki.oids.pkcs8ShroudedKeyBag,
      })[forge.pki.oids.pkcs8ShroudedKeyBag];
      const legacyBags = pkcs12.getBags({
        bagType: forge.pki.oids.keyBag,
      })[forge.pki.oids.keyBag];

      return (shroudedBags?.[0]?.key ??
        legacyBags?.[0]?.key ??
        null) as forge.pki.PrivateKey | null;
    } catch {
      return null;
    }
  }

  private extractLeafCertificate(pkcs12: forge.pkcs12.Pkcs12Pfx): forge.pki.Certificate | null {
    try {
      const certBags = pkcs12.getBags({
        bagType: forge.pki.oids.certBag,
      })[forge.pki.oids.certBag];
      return (certBags?.[0]?.cert ?? null) as forge.pki.Certificate | null;
    } catch {
      return null;
    }
  }

  private extractOid2545(cert: forge.pki.Certificate): string | null {
    try {
      // Try shortName first (forge maps OID 2.5.4.5 to 'SERIALNUMBER')
      const byShortName = cert.subject.getField({ shortName: 'SERIALNUMBER' });
      if (byShortName?.value) {
        return String(byShortName.value);
      }
      // Fallback: iterate attributes looking for the OID directly
      for (const attr of cert.subject.attributes) {
        if ((attr as { type?: string }).type === '2.5.4.5') {
          return attr.value ? String(attr.value) : null;
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Normalize the raw OID 2.5.4.5 value.
   * - Strip any known prefix (CPJ-, CF-, DIMEX-, PE-, PN-)
   * - Trim whitespace
   * - Derive type code from prefix when possible
   */
  private normalizeOidValue(rawValue: string): {
    extractedIdentityNumber: string;
    extractedIdentityType: string | null;
  } {
    const trimmed = rawValue.trim();
    for (const [prefix, typeCode] of Object.entries(PREFIX_TO_TYPE)) {
      if (trimmed.toUpperCase().startsWith(prefix.toUpperCase())) {
        return {
          extractedIdentityNumber: trimmed.substring(prefix.length).trim(),
          extractedIdentityType: typeCode,
        };
      }
    }
    // No known prefix — strip generic prefixes (PE-, PN-) and return null type
    for (const genericPrefix of ['PE-', 'PN-']) {
      if (trimmed.toUpperCase().startsWith(genericPrefix.toUpperCase())) {
        return {
          extractedIdentityNumber: trimmed.substring(genericPrefix.length).trim(),
          extractedIdentityType: null,
        };
      }
    }
    // No prefix — raw value is already the number
    return {
      extractedIdentityNumber: trimmed,
      extractedIdentityType: null,
    };
  }

  /** Build a human-readable DN string from forge certificate attributes. */
  private formatDn(attributes: forge.pki.CertificateField[]): string {
    return attributes
      .map((a) => {
        const shortName = (a as { shortName?: string }).shortName ?? a.type ?? '';
        return `${shortName}=${String(a.value ?? '')}`;
      })
      .join(', ');
  }
}
