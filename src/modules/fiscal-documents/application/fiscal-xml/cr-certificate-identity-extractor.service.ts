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
export interface CrCertificateIdentity {
  /** Raw OID 2.5.4.5 value exactly as represented by the certificate subject. */
  rawIdentity: string;
  /** Canonical Billing/Prisma company identification type, when derivable. */
  identityType: 'FISICA' | 'JURIDICA' | 'DIMEX' | null;
  /** Canonical Costa Rica fiscal identification used in electronic invoices. */
  normalizedIdentificationNumber: string;
}

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
   * Canonical fiscal identification number extracted from OID 2.5.4.5.
   * This is intentionally NOT the raw OID string. Example:
   * 'CPF-02-0753-0251' → '207530251'.
   */
  extractedIdentityNumber: string;
  /**
   * Existing persisted certificate type code:
   * '01'=FISICA, '02'=JURIDICA, '03'=DIMEX, null when no explicit type exists.
   */
  extractedIdentityType: string | null;
  /** Safe audit metadata: raw OID 2.5.4.5 identity representation. */
  rawIdentity: string;
  /** Canonical identity representation used by Billing's domain. */
  canonicalIdentity: CrCertificateIdentity;
}

const PRISMA_TYPE_TO_CODE: Record<Exclude<CrCertificateIdentity['identityType'], null>, string> = {
  FISICA: '01',
  JURIDICA: '02',
  DIMEX: '03',
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

    const canonicalIdentity = this.normalizeOidValue(rawOidValue);

    return {
      fingerprintSha256: createHash('sha256').update(pkcs12Bytes).digest('hex'),
      x509SerialNumber: cert.serialNumber,
      subjectName: this.formatDn(cert.subject.attributes),
      issuerName: this.formatDn(cert.issuer.attributes),
      validFrom: new Date(cert.validity.notBefore),
      validTo: new Date(cert.validity.notAfter),
      extractedIdentityNumber: canonicalIdentity.normalizedIdentificationNumber,
      extractedIdentityType:
        canonicalIdentity.identityType === null
          ? null
          : PRISMA_TYPE_TO_CODE[canonicalIdentity.identityType],
      rawIdentity: canonicalIdentity.rawIdentity,
      canonicalIdentity,
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
   * Normalize the raw OID 2.5.4.5 value into Billing's canonical fiscal identity.
   *
   * Important: this is NOT a blind non-digit strip. Certificate formatting is a
   * transport representation; Company.identificationNumber stores the canonical
   * CR fiscal identification used in XML payloads.
   */
  private normalizeOidValue(rawValue: string): CrCertificateIdentity {
    const rawIdentity = rawValue.trim();
    const upper = rawIdentity.toUpperCase();

    const cpf = /^CPF-(\d{2})-(\d{4})-(\d{4})$/i.exec(rawIdentity);
    if (cpf) {
      const firstComponent = Number(cpf[1]);
      if (!Number.isInteger(firstComponent) || firstComponent < 1 || firstComponent > 9) {
        throw new FiscalCertificateIdentityUnreadableException();
      }
      return {
        rawIdentity,
        identityType: 'FISICA',
        normalizedIdentificationNumber: `${firstComponent}${cpf[2]}${cpf[3]}`,
      };
    }

    const cf = /^CF-(\d{9})$/i.exec(rawIdentity);
    if (cf) {
      return { rawIdentity, identityType: 'FISICA', normalizedIdentificationNumber: cf[1] };
    }

    const cpj = /^CPJ-(\d{10})$/i.exec(rawIdentity);
    if (cpj) {
      return { rawIdentity, identityType: 'JURIDICA', normalizedIdentificationNumber: cpj[1] };
    }

    const dimex = /^DIMEX-(\d{11,12})$/i.exec(rawIdentity);
    if (dimex) {
      return { rawIdentity, identityType: 'DIMEX', normalizedIdentificationNumber: dimex[1] };
    }

    // Existing supported legacy fixture: a bare numeric fiscal id in OID 2.5.4.5.
    if (/^\d{9,12}$/.test(rawIdentity)) {
      return { rawIdentity, identityType: null, normalizedIdentificationNumber: rawIdentity };
    }

    // Explicit fail-closed behavior for unsupported prefixes/structures.
    if (upper.includes('-') || /^[A-Z]+/.test(upper)) {
      throw new FiscalCertificateIdentityUnreadableException();
    }

    throw new FiscalCertificateIdentityUnreadableException();
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
