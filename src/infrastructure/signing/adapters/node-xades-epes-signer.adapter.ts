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

@Injectable()
export class NodeXadesEpesSignerAdapter implements XmlSignerPort {
  async sign(xmlDocument: string, certificate: Pkcs12Certificate): Promise<string> {
    const material = this.parseMaterial(certificate);
    this.assertSha1Absent();
    const signatureId = `Signature-${crypto.randomUUID()}`;
    const signedPropertiesId = `${signatureId}-SignedProperties`;
    const digestValue = this.digest(this.canonicalizeXmlDocument(xmlDocument));
    const signedProperties = this.buildSignedProperties(
      signatureId,
      signedPropertiesId,
      material.certificateDerBase64,
    );
    const signedPropertiesDigest = this.digest(this.canonicalizeElementXml(signedProperties));
    const signedInfo = this.buildSignedInfo(
      digestValue,
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

  private buildSignedInfo(
    documentDigest: string,
    signedPropertiesId: string,
    signedPropertiesDigest: string,
  ): string {
    return `<ds:SignedInfo xmlns:ds="${HACIENDA_V44_XADES_CONTRACT.xmlDsigNamespace}"><ds:CanonicalizationMethod Algorithm="${HACIENDA_V44_XADES_CONTRACT.canonicalizationAlgorithm}"/><ds:SignatureMethod Algorithm="${HACIENDA_V44_XADES_CONTRACT.signatureMethodAlgorithm}"/><ds:Reference URI=""><ds:Transforms><ds:Transform Algorithm="${HACIENDA_V44_XADES_CONTRACT.primaryReferenceTransforms[0].algorithm}"><ds:XPath>${HACIENDA_V44_XADES_CONTRACT.primaryReferenceTransforms[0].xpath}</ds:XPath></ds:Transform><ds:Transform Algorithm="${HACIENDA_V44_XADES_CONTRACT.primaryReferenceTransforms[1].algorithm}"/></ds:Transforms><ds:DigestMethod Algorithm="${HACIENDA_V44_XADES_CONTRACT.digestMethodAlgorithm}"/><ds:DigestValue>${documentDigest}</ds:DigestValue></ds:Reference><ds:Reference Type="${HACIENDA_V44_XADES_CONTRACT.signedPropertiesReferenceType}" URI="#${signedPropertiesId}"><ds:Transforms><ds:Transform Algorithm="${HACIENDA_V44_XADES_CONTRACT.signedPropertiesTransformAlgorithm}"/></ds:Transforms><ds:DigestMethod Algorithm="${HACIENDA_V44_XADES_CONTRACT.digestMethodAlgorithm}"/><ds:DigestValue>${signedPropertiesDigest}</ds:DigestValue></ds:Reference></ds:SignedInfo>`;
  }

  private buildSignatureXml(
    signatureId: string,
    signedInfo: string,
    signatureValue: string,
    certificateDerBase64: string,
    signedProperties: string,
  ): string {
    return `<ds:Signature Id="${signatureId}" xmlns:ds="${HACIENDA_V44_XADES_CONTRACT.xmlDsigNamespace}">${signedInfo}<ds:SignatureValue>${signatureValue}</ds:SignatureValue><ds:KeyInfo><ds:X509Data><ds:X509Certificate>${certificateDerBase64}</ds:X509Certificate></ds:X509Data></ds:KeyInfo><ds:Object><xades:QualifyingProperties xmlns:xades="${HACIENDA_V44_XADES_CONTRACT.xadesNamespace}" Target="#${signatureId}">${signedProperties}</xades:QualifyingProperties></ds:Object></ds:Signature>`;
  }

  private buildSignedProperties(
    signatureId: string,
    signedPropertiesId: string,
    certificateDerBase64: string,
  ): string {
    const certificateDigest = this.digest(Buffer.from(certificateDerBase64, 'base64'));
    return `<xades:SignedProperties Id="${signedPropertiesId}" xmlns:xades="${HACIENDA_V44_XADES_CONTRACT.xadesNamespace}" xmlns:ds="${HACIENDA_V44_XADES_CONTRACT.xmlDsigNamespace}"><xades:SignedSignatureProperties><xades:SigningTime>${new Date().toISOString()}</xades:SigningTime><xades:SigningCertificate><xades:Cert><xades:CertDigest><ds:DigestMethod Algorithm="${HACIENDA_V44_XADES_CONTRACT.digestMethodAlgorithm}"/><ds:DigestValue>${certificateDigest}</ds:DigestValue></xades:CertDigest></xades:Cert></xades:SigningCertificate><xades:SignaturePolicyIdentifier><xades:SignaturePolicyId><xades:SigPolicyId><xades:Identifier>${HACIENDA_V44_XADES_CONTRACT.signaturePolicyDocumentUrl}</xades:Identifier></xades:SigPolicyId><xades:SigPolicyHash><ds:DigestMethod Algorithm="${HACIENDA_V44_XADES_CONTRACT.digestMethodAlgorithm}"/><ds:DigestValue>${HACIENDA_V44_XADES_CONTRACT.signaturePolicyDocumentSha256}</ds:DigestValue></xades:SigPolicyHash></xades:SignaturePolicyId></xades:SignaturePolicyIdentifier></xades:SignedSignatureProperties></xades:SignedProperties>`;
  }

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

  private assertSha1Absent(xml?: string): void {
    const activePolicyUrl = HACIENDA_V44_XADES_CONTRACT.signaturePolicyDocumentUrl.toLowerCase();
    const signedXml = xml?.toLowerCase() ?? '';
    if (signedXml.includes('rsa-sha1') || signedXml.includes('xmldsig#sha1')) {
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
