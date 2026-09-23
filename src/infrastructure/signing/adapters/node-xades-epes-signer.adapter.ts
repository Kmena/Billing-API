import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';
import * as forge from 'node-forge';
import {
  Pkcs12Certificate,
  SignatureVerificationResult,
  XmlSignerPort,
} from '../ports/xml-signer.port';
import { HACIENDA_V44_XADES_CONTRACT } from '../../../modules/fiscal-documents/domain/fiscal-xml/hacienda-v44-contract';

interface SigningMaterial {
  readonly privateKeyPem: string;
  readonly certificatePem: string;
  readonly certificateDerBase64: string;
  readonly passphrase?: string;
}

interface SerializedSigningMaterial {
  readonly pkcs12Base64?: string;
  readonly privateKeyPem?: string;
  readonly certificatePem?: string;
  readonly passphrase?: string;
}

// ── ID helpers ────────────────────────────────────────────────────────────────
// Official v4.4 pattern (ANEXOS_Y_ESTRUCTURAS_V4.4.pdf, Anexo 2, pages 87-88):
//   <ds:Signature Id="id-{hexUUID}">
//   <ds:Reference Id="r-id-1">          ← fixed, one document reference
//   <ds:SignatureValue Id="value-id{hexUUID}">
//   <xades:SignedProperties Id="xades-id-{hexUUID}">
//   QualifyingProperties Target="#id-{hexUUID}"
//   Reference URI="#xades-id-{hexUUID}"
//   DataObjectFormat ObjectReference="#r-id-1"
const DOCUMENT_REFERENCE_ID = 'r-id-1' as const;

function newHexId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

@Injectable()
export class NodeXadesEpesSignerAdapter implements XmlSignerPort {
  async sign(xmlDocument: string, certificate: Pkcs12Certificate): Promise<string> {
    this.assertPolicyIntegrity();
    const material = this.parseMaterial(certificate);
    this.assertSha1Absent();

    // Generate a single random hex ID shared across all correlated IDs in this signature
    const hexId = newHexId();
    const signatureId = `id-${hexId}`;
    const signedPropertiesId = `xades-id-${hexId}`;
    const signatureValueId = `value-id${hexId}`;

    const digestValue = this.digest(this.canonicalizeXmlDocument(xmlDocument));
    const signedProperties = this.buildSignedProperties(
      signedPropertiesId,
      material.certificateDerBase64,
      DOCUMENT_REFERENCE_ID,
    );
    const signedPropertiesDigest = this.digest(this.canonicalizeElementXml(signedProperties));
    const signedInfo = this.buildSignedInfo(
      digestValue,
      DOCUMENT_REFERENCE_ID,
      signedPropertiesId,
      signedPropertiesDigest,
    );
    const signatureValue = crypto
      .sign('RSA-SHA256', Buffer.from(this.canonicalizeElementXml(signedInfo), 'utf8'), {
        key: material.privateKeyPem,
        passphrase: material.passphrase,
      })
      .toString('base64');
    const signatureXml = this.buildSignatureXml(
      signatureId,
      signatureValueId,
      signedInfo,
      signatureValue,
      material.certificateDerBase64,
      signedProperties,
    );
    return this.insertSignature(xmlDocument, signatureXml);
  }

  async verify(signedXml: string): Promise<SignatureVerificationResult> {
    try {
      this.assertSha1Absent(signedXml);
      if (!signedXml.includes(HACIENDA_V44_XADES_CONTRACT.signaturePolicyDocumentUrl)) {
        return this.failure('FISCAL_XML_SIGNATURE_POLICY_MISSING');
      }
      const parser = new DOMParser({ errorHandler: () => undefined });
      const document = parser.parseFromString(signedXml, 'application/xml');
      const signatures = Array.from(document.getElementsByTagName('ds:Signature'));
      if (signatures.length !== 1) return this.failure('FISCAL_XML_SIGNATURE_COUNT_INVALID');
      const signature = signatures[0] as unknown as XmlNode;
      const signedInfo = this.firstElementXml(signature, 'ds:SignedInfo');
      const signatureValue = this.firstText(signature, 'ds:SignatureValue').replace(/\s+/g, '');
      const certificate = this.firstText(signature, 'ds:X509Certificate').replace(/\s+/g, '');
      const unsignedXml = this.removeSignature(signedXml);
      const expectedDigest = this.firstText(signature, 'ds:DigestValue');
      if (this.digest(this.canonicalizeXmlDocument(unsignedXml)) !== expectedDigest) {
        return this.failure('FISCAL_XML_DIGEST_MISMATCH');
      }
      const verified = crypto.verify(
        'RSA-SHA256',
        Buffer.from(this.canonicalizeElementXml(signedInfo), 'utf8'),
        new crypto.X509Certificate(Buffer.from(certificate, 'base64')).publicKey,
        Buffer.from(signatureValue, 'base64'),
      );
      if (!verified) return this.failure('FISCAL_XML_SIGNATURE_INVALID');
      const x509Certificate = new crypto.X509Certificate(Buffer.from(certificate, 'base64'));
      const signedAt = this.tryReadSigningTime(signature);
      return {
        isValid: true,
        validationErrors: [],
        signerName: x509Certificate.subject,
        signedAt: signedAt ?? new Date(),
      };
    } catch (error) {
      return this.failure(error instanceof Error ? error.message : 'FISCAL_XML_SIGNATURE_INVALID');
    }
  }

  // ── Private builders ────────────────────────────────────────────────────────

  private buildSignedInfo(
    documentDigest: string,
    documentReferenceId: string,
    signedPropertiesId: string,
    signedPropertiesDigest: string,
  ): string {
    const c = HACIENDA_V44_XADES_CONTRACT;
    // Document reference carries Id and Type="" per official v4.4 example (Anexo 2, page 87)
    return (
      `<ds:SignedInfo xmlns:ds="${c.xmlDsigNamespace}">` +
      `<ds:CanonicalizationMethod Algorithm="${c.canonicalizationAlgorithm}"/>` +
      `<ds:SignatureMethod Algorithm="${c.signatureMethodAlgorithm}"/>` +
      `<ds:Reference Id="${documentReferenceId}" Type="" URI="${c.primaryReferenceUri}">` +
      `<ds:Transforms>` +
      `<ds:Transform Algorithm="${c.primaryReferenceTransforms[0].algorithm}">` +
      `<ds:XPath>${c.primaryReferenceTransforms[0].xpath}</ds:XPath>` +
      `</ds:Transform>` +
      `<ds:Transform Algorithm="${c.primaryReferenceTransforms[1].algorithm}"/>` +
      `</ds:Transforms>` +
      `<ds:DigestMethod Algorithm="${c.digestMethodAlgorithm}"/>` +
      `<ds:DigestValue>${documentDigest}</ds:DigestValue>` +
      `</ds:Reference>` +
      `<ds:Reference Type="${c.signedPropertiesReferenceType}" URI="#${signedPropertiesId}">` +
      `<ds:Transforms>` +
      `<ds:Transform Algorithm="${c.signedPropertiesTransformAlgorithm}"/>` +
      `</ds:Transforms>` +
      `<ds:DigestMethod Algorithm="${c.digestMethodAlgorithm}"/>` +
      `<ds:DigestValue>${signedPropertiesDigest}</ds:DigestValue>` +
      `</ds:Reference>` +
      `</ds:SignedInfo>`
    );
  }

  private buildSignatureXml(
    signatureId: string,
    signatureValueId: string,
    signedInfo: string,
    signatureValue: string,
    certificateDerBase64: string,
    signedProperties: string,
  ): string {
    const c = HACIENDA_V44_XADES_CONTRACT;
    return (
      `<ds:Signature Id="${signatureId}" xmlns:ds="${c.xmlDsigNamespace}">` +
      signedInfo +
      `<ds:SignatureValue Id="${signatureValueId}">${signatureValue}</ds:SignatureValue>` +
      `<ds:KeyInfo>` +
      `<ds:X509Data>` +
      `<ds:X509Certificate>${certificateDerBase64}</ds:X509Certificate>` +
      `</ds:X509Data>` +
      `</ds:KeyInfo>` +
      `<ds:Object>` +
      `<xades:QualifyingProperties xmlns:xades="${c.xadesNamespace}" Target="#${signatureId}">` +
      signedProperties +
      `</xades:QualifyingProperties>` +
      `</ds:Object>` +
      `</ds:Signature>`
    );
  }

  private buildSignedProperties(
    signedPropertiesId: string,
    certificateDerBase64: string,
    documentReferenceId: string,
  ): string {
    const c = HACIENDA_V44_XADES_CONTRACT;
    // CertDigest uses SHA-1 per official v4.4 spec (Anexo 2, pages 87-88)
    const certBytes = Buffer.from(certificateDerBase64, 'base64');
    const certificateDigest = crypto
      .createHash('sha1')
      .update(certBytes)
      .digest('base64');
    const { issuerName, serialNumber } = this.buildIssuerSerial(certBytes);

    return (
      `<xades:SignedProperties Id="${signedPropertiesId}"` +
      ` xmlns:xades="${c.xadesNamespace}"` +
      ` xmlns:ds="${c.xmlDsigNamespace}">` +
      `<xades:SignedSignatureProperties>` +
      `<xades:SigningTime>${new Date().toISOString()}</xades:SigningTime>` +
      `<xades:SigningCertificate>` +
      `<xades:Cert>` +
      `<xades:CertDigest>` +
      `<ds:DigestMethod Algorithm="${c.certDigestAlgorithm}"/>` +
      `<ds:DigestValue>${certificateDigest}</ds:DigestValue>` +
      `</xades:CertDigest>` +
      `<xades:IssuerSerial>` +
      `<ds:X509IssuerName>${issuerName}</ds:X509IssuerName>` +
      `<ds:X509SerialNumber>${serialNumber}</ds:X509SerialNumber>` +
      `</xades:IssuerSerial>` +
      `</xades:Cert>` +
      `</xades:SigningCertificate>` +
      `<xades:SignaturePolicyIdentifier>` +
      `<xades:SignaturePolicyId>` +
      `<xades:SigPolicyId>` +
      `<xades:Identifier>${c.signaturePolicyDocumentUrl}</xades:Identifier>` +
      `</xades:SigPolicyId>` +
      `<xades:SigPolicyHash>` +
      `<ds:DigestMethod Algorithm="${c.digestMethodAlgorithm}"/>` +
      `<ds:DigestValue>${c.signaturePolicyDocumentSha256Base64}</ds:DigestValue>` +
      `</xades:SigPolicyHash>` +
      `</xades:SignaturePolicyId>` +
      `</xades:SignaturePolicyIdentifier>` +
      `</xades:SignedSignatureProperties>` +
      `<xades:SignedDataObjectProperties>` +
      `<xades:DataObjectFormat ObjectReference="#${documentReferenceId}">` +
      `<xades:MimeType>${c.dataObjectMimeType}</xades:MimeType>` +
      `</xades:DataObjectFormat>` +
      `</xades:SignedDataObjectProperties>` +
      `</xades:SignedProperties>`
    );
  }

  /**
   * Derive IssuerSerial from a certificate DER buffer.
   * IssuerName: RFC2253-style string from Node.js x509.issuer.
   * SerialNumber: decimal representation of the certificate serial.
   */
  private buildIssuerSerial(certDerBytes: Buffer): {
    issuerName: string;
    serialNumber: string;
  } {
    const x509 = new crypto.X509Certificate(certDerBytes);
    // Node.js returns issuer as "key=value\nkey=value" lines.
    // Join with commas for the XAdES ds:X509IssuerName value.
    const issuerName = x509.issuer
      .split('\n')
      .filter((s) => s.length > 0)
      .join(',');
    // serialNumber is a hex string; convert to decimal for ds:X509SerialNumber
    const serialNumber = BigInt('0x' + x509.serialNumber).toString(10);
    return { issuerName, serialNumber };
  }

  // ── Certificate parsing ──────────────────────────────────────────────────────

  private parseMaterial(certificate: Pkcs12Certificate): SigningMaterial {
    const serialized = this.tryParseSerializedMaterial(certificate.data);
    if (serialized?.pkcs12Base64) {
      return this.parsePkcs12(
        Buffer.from(serialized.pkcs12Base64, 'base64'),
        certificate.passphrase,
      );
    }
    if (serialized?.privateKeyPem && serialized.certificatePem) {
      if ((serialized.passphrase ?? '') !== certificate.passphrase) {
        throw new Error('INVALID_CERTIFICATE_PASSWORD');
      }
      return {
        privateKeyPem: serialized.privateKeyPem,
        certificatePem: serialized.certificatePem,
        certificateDerBase64: this.derBase64FromCertificatePem(serialized.certificatePem),
        passphrase: serialized.passphrase,
      };
    }
    return this.parsePkcs12(certificate.data, certificate.passphrase);
  }

  private tryParseSerializedMaterial(data: Buffer): SerializedSigningMaterial | null {
    try {
      const parsed = JSON.parse(data.toString('utf8')) as SerializedSigningMaterial;
      return parsed;
    } catch {
      return null;
    }
  }

  private parsePkcs12(pkcs12Bytes: Buffer, passphrase: string): SigningMaterial {
    try {
      const binary = pkcs12Bytes.toString('binary');
      const asn1 = forge.asn1.fromDer(binary);
      const pkcs12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, passphrase);
      const privateKey = this.firstPkcs12PrivateKey(pkcs12);
      const certificate = this.firstPkcs12Certificate(pkcs12);
      if (!privateKey || !certificate) throw new Error('INVALID_SIGNING_MATERIAL');
      const certificatePem = forge.pki.certificateToPem(certificate);
      return {
        privateKeyPem: forge.pki.privateKeyToPem(privateKey),
        certificatePem,
        certificateDerBase64: this.derBase64FromCertificatePem(certificatePem),
        passphrase,
      };
    } catch (error) {
      if (error instanceof Error && error.message === 'INVALID_SIGNING_MATERIAL') throw error;
      throw new Error('INVALID_CERTIFICATE_PASSWORD');
    }
  }

  private firstPkcs12PrivateKey(pkcs12: forge.pkcs12.Pkcs12Pfx): forge.pki.PrivateKey | null {
    const keyBags = pkcs12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[
      forge.pki.oids.pkcs8ShroudedKeyBag
    ];
    const legacyKeyBags = pkcs12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag];
    return (keyBags?.[0]?.key ?? legacyKeyBags?.[0]?.key ?? null) as forge.pki.PrivateKey | null;
  }

  private firstPkcs12Certificate(pkcs12: forge.pkcs12.Pkcs12Pfx): forge.pki.Certificate | null {
    const certBags = pkcs12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag];
    return (certBags?.[0]?.cert ?? null) as forge.pki.Certificate | null;
  }

  // ── XML helpers ──────────────────────────────────────────────────────────────

  private insertSignature(xml: string, signatureXml: string): string {
    const closingRoot = xml.match(/<\/[^>]+>\s*$/)?.[0];
    if (!closingRoot) throw new Error('FISCAL_XML_ROOT_CLOSING_TAG_NOT_FOUND');
    return xml.replace(/<\/[^>]+>\s*$/, `${signatureXml}${closingRoot}`);
  }

  private removeSignature(signedXml: string): string {
    return signedXml.replace(/<ds:Signature[\s\S]*?<\/ds:Signature>/, '');
  }

  private firstText(parent: XmlNode, tagName: string): string {
    const element = parent.getElementsByTagName(tagName)[0];
    if (!element?.firstChild) throw new Error(`${tagName}_MISSING`);
    return element.firstChild.nodeValue ?? '';
  }

  private firstElementXml(parent: XmlNode, tagName: string): string {
    const element = parent.getElementsByTagName(tagName)[0];
    if (!element) throw new Error(`${tagName}_MISSING`);
    return new XMLSerializer().serializeToString(element as never);
  }

  private firstOptionalText(parent: XmlNode, tagName: string): string | undefined {
    const element = parent.getElementsByTagName(tagName)[0];
    return element?.firstChild?.nodeValue ?? undefined;
  }

  private digest(value: string | Buffer): string {
    return crypto.createHash('sha256').update(value).digest('base64');
  }

  private canonicalizeXmlDocument(xml: string): string {
    const document = new DOMParser({ errorHandler: () => undefined }).parseFromString(
      xml,
      'application/xml',
    );
    return this.canonicalizeNode(document.documentElement as unknown as Node);
  }

  private canonicalizeElementXml(xml: string): string {
    const document = new DOMParser({ errorHandler: () => undefined }).parseFromString(
      xml,
      'application/xml',
    );
    return this.canonicalizeNode(document.documentElement as unknown as Node);
  }

  private canonicalizeNode(node: Node): string {
    return new SignedXml().getCanonXml(
      [HACIENDA_V44_XADES_CONTRACT.canonicalizationAlgorithm],
      node,
    );
  }

  private derBase64FromCertificatePem(pem: string): string {
    return pem.replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s+/g, '');
  }

  private tryReadSigningTime(signature: XmlNode): Date | undefined {
    const signingTime = this.firstOptionalText(signature, 'xades:SigningTime');
    if (!signingTime) return undefined;
    const parsed = new Date(signingTime);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  // ── Policy guards (fail-closed) ──────────────────────────────────────────────

  /**
   * Fail-closed guard: signing MUST NOT proceed if the Hacienda signature
   * policy is absent, a placeholder, or structurally invalid.
   * Validates against the official v4.4 spec values from HACIENDA_V44_XADES_CONTRACT.
   */
  private assertPolicyIntegrity(): void {
    const url = HACIENDA_V44_XADES_CONTRACT.signaturePolicyDocumentUrl;
    const hashBase64 = HACIENDA_V44_XADES_CONTRACT.signaturePolicyDocumentSha256Base64;
    // URL must be present and not the legacy placeholder
    if (!url || url.toUpperCase().includes('URLXXXXV4.4')) {
      throw new Error('HACIENDA_SIGNATURE_POLICY_INVALID');
    }
    if (!hashBase64) {
      throw new Error('HACIENDA_SIGNATURE_POLICY_INVALID');
    }
    let decoded: Buffer;
    try {
      decoded = Buffer.from(hashBase64, 'base64');
    } catch {
      throw new Error('HACIENDA_SIGNATURE_POLICY_INVALID');
    }
    // Must decode to exactly 32 bytes (SHA-256 output length per official v4.4 spec)
    if (decoded.length !== 32) {
      throw new Error('HACIENDA_SIGNATURE_POLICY_INVALID');
    }
    // Belt-and-suspenders: reject a 64-char hex accidentally used as base64
    // (decodes to 48 bytes, caught by length check, but be explicit)
    if (/^[0-9a-f]{64}$/i.test(hashBase64)) {
      throw new Error('HACIENDA_SIGNATURE_POLICY_INVALID');
    }
  }

  /**
   * SHA-1 is prohibited for signing and reference digests throughout the
   * Hacienda v4.4 XAdES signature, EXCEPT in <xades:CertDigest> where the
   * official v4.4 spec (Anexo 2) explicitly requires it.
   * Strip CertDigest before scanning so that legitimate SHA-1 usage is not flagged.
   */
  private assertSha1Absent(xml?: string): void {
    const activePolicyUrl = HACIENDA_V44_XADES_CONTRACT.signaturePolicyDocumentUrl.toLowerCase();
    // Strip CertDigest (legitimately SHA-1 per Hacienda v4.4 Anexo 2)
    const stripped = (xml ?? '')
      .replace(/<xades:CertDigest>[\s\S]*?<\/xades:CertDigest>/gi, '')
      .toLowerCase();
    if (stripped.includes('rsa-sha1') || stripped.includes('xmldsig#sha1')) {
      throw new Error('SHA1_ALGORITHM_PROHIBITED');
    }
    if (activePolicyUrl.includes('urlxxxxv4.4')) throw new Error('PLACEHOLDER_POLICY_PROHIBITED');
  }

  private failure(error: string): SignatureVerificationResult {
    return { isValid: false, validationErrors: [error] };
  }
}

interface XmlNode {
  getElementsByTagName(tagName: string): ArrayLike<{
    firstChild?: { nodeValue?: string | null };
  }>;
}
