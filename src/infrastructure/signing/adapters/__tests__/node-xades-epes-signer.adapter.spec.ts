import * as crypto from 'crypto';
import { DOMParser, Element as XmldomElement } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';
import { NodeXadesEpesSignerAdapter } from '../node-xades-epes-signer.adapter';
import { HaciendaV44XmlSerializerAdapter } from '../../../../modules/fiscal-documents/infrastructure/xml/hacienda-v44-xml-serializer.adapter';
import { Xsd11ValidatorAdapter } from '../../../../modules/fiscal-documents/infrastructure/xml/xsd11-validator.adapter';
import {
  createFiscalXmlSnapshot,
  createTestSigningMaterial,
} from '../../../../modules/fiscal-documents/domain/fiscal-xml/__tests__/fiscal-xml-test-fixtures';
import { HACIENDA_V44_XADES_CONTRACT } from '../../../../modules/fiscal-documents/domain/fiscal-xml/hacienda-v44-contract';

// ── Independent xml-crypto verifier ──────────────────────────────────────────
// Registers the Hacienda XPath transform so xml-crypto can process it.

class HaciendaXPathTransform {
  process(node: Node, options?: { signatureNode?: Node | null }): Node {
    const nodeElement = node as unknown as XmldomElement;
    const signatures = Array.from(nodeElement.getElementsByTagName('ds:Signature'));
    const signatureValue = this.signatureValueFrom(options?.signatureNode);

    for (const signature of signatures) {
      if (!signatureValue || this.firstText(signature, 'ds:SignatureValue') === signatureValue) {
        signature.parentNode?.removeChild(signature);
      }
    }

    return node;
  }

  getAlgorithmName(): string {
    return HACIENDA_V44_XADES_CONTRACT.primaryReferenceTransforms[0].algorithm;
  }

  private signatureValueFrom(signatureNode?: Node | null): string | undefined {
    if (!signatureNode) return undefined;
    return this.firstText(signatureNode as unknown as XmldomElement, 'ds:SignatureValue');
  }

  private firstText(parent: XmldomElement, tagName: string): string {
    const element = parent.getElementsByTagName(tagName)[0];
    if (!element?.firstChild?.nodeValue) return '';
    return element.firstChild.nodeValue.replace(/\s+/g, '');
  }
}

class XmlCryptoXadesVerifier {
  verify(signedXml: string): { isValid: boolean; error?: string; certificateSubject?: string } {
    try {
      // Check for the official percent-encoded policy URL (official v4.4 Anexo 2)
      if (!signedXml.includes(HACIENDA_V44_XADES_CONTRACT.signaturePolicyDocumentUrl)) {
        return { isValid: false, error: 'FISCAL_XML_SIGNATURE_POLICY_MISSING' };
      }
      const document = new DOMParser({ errorHandler: () => undefined }).parseFromString(
        signedXml,
        'application/xml',
      );
      const signatures = Array.from(document.getElementsByTagName('ds:Signature'));
      if (signatures.length !== 1) {
        return { isValid: false, error: 'FISCAL_XML_SIGNATURE_COUNT_INVALID' };
      }
      const signature = signatures[0];
      const certificateDerBase64 = this.firstText(signature, 'ds:X509Certificate');
      const certificate = new crypto.X509Certificate(Buffer.from(certificateDerBase64, 'base64'));
      const verifier = new SignedXml({
        getCertFromKeyInfo: () => this.toPemCertificate(certificateDerBase64),
      });
      verifier.CanonicalizationAlgorithms[
        HACIENDA_V44_XADES_CONTRACT.primaryReferenceTransforms[0].algorithm
      ] = HaciendaXPathTransform;
      verifier.loadSignature(signature as unknown as Node);
      const isValid = verifier.checkSignature(signedXml);

      return isValid
        ? { isValid: true, certificateSubject: certificate.subject }
        : { isValid: false, error: 'FISCAL_XML_SIGNATURE_INVALID' };
    } catch (error) {
      return { isValid: false, error: error instanceof Error ? error.message : 'INVALID' };
    }
  }

  private firstText(parent: XmldomElement, tagName: string): string {
    const element = parent.getElementsByTagName(tagName)[0];
    if (!element?.firstChild?.nodeValue) throw new Error(`${tagName}_MISSING`);
    return element.firstChild.nodeValue.replace(/\s+/g, '');
  }

  private toPemCertificate(certificateDerBase64: string): string {
    return `-----BEGIN CERTIFICATE-----\n${certificateDerBase64
      .match(/.{1,64}/g)
      ?.join('\n')}\n-----END CERTIFICATE-----`;
  }
}

// ── Basic signer behaviour ────────────────────────────────────────────────────

describe('NodeXadesEpesSignerAdapter', () => {
  const serializer = new HaciendaV44XmlSerializerAdapter();
  const signer = new NodeXadesEpesSignerAdapter();
  const xsdValidator = new Xsd11ValidatorAdapter();
  const standardsVerifier = new XmlCryptoXadesVerifier();

  it('signs FE XML with XAdES-EPES metadata, verifies it and passes official XSD', async () => {
    const xml = serializer.serialize(createFiscalXmlSnapshot('INVOICE')).xml;
    const material = createTestSigningMaterial();

    const signedXml = await signer.sign(xml, material.certificate);
    const verification = await signer.verify(signedXml);

    expect(signedXml).toContain('http://uri.etsi.org/01903/v1.3.2#');
    expect(signedXml).toContain('SignaturePolicyIdentifier');
    expect(signedXml).toContain('xmldsig-more#rsa-sha256');
    expect(signedXml).toContain('xmlenc#sha256');
    expect(signedXml).not.toContain('rsa-sha1');
    const independentVerification = standardsVerifier.verify(signedXml);

    expect(verification.isValid).toBe(true);
    expect(independentVerification).toMatchObject({
      isValid: true,
      certificateSubject: material.x509Subject,
    });
    expect(signedXml).toContain(material.certificateDerBase64);
    expect(
      xsdValidator.validate({
        ...serializer.serialize(createFiscalXmlSnapshot('INVOICE')),
        xml: signedXml,
      }),
    ).toMatchObject({
      isValid: true,
    });
  });

  it('signs TE XML, verifies it and passes official XSD', async () => {
    const generated = serializer.serialize(createFiscalXmlSnapshot('TICKET'));
    const material = createTestSigningMaterial();

    const signedXml = await signer.sign(generated.xml, material.certificate);
    const verification = await signer.verify(signedXml);
    const validation = xsdValidator.validate({ ...generated, xml: signedXml });

    expect(signedXml).toContain('<ds:Signature');
    expect(verification.isValid).toBe(true);
    expect(standardsVerifier.verify(signedXml)).toMatchObject({ isValid: true });
    expect(validation).toMatchObject({ isValid: true, errors: [] });
  });

  it('rejects tampered signed XML', async () => {
    const xml = serializer.serialize(createFiscalXmlSnapshot('INVOICE')).xml;
    const material = createTestSigningMaterial();

    const signedXml = await signer.sign(xml, material.certificate);
    const tampered = signedXml.replace('1130.00000', '9999.00000');
    const verification = await signer.verify(tampered);

    const independentVerification = standardsVerifier.verify(tampered);

    expect(verification.isValid).toBe(false);
    expect(verification.validationErrors).toContain('FISCAL_XML_DIGEST_MISMATCH');
    expect(independentVerification).toMatchObject({
      isValid: false,
      error: 'FISCAL_XML_SIGNATURE_INVALID',
    });
  });

  it('rejects signed XML with more than one signature element', async () => {
    const xml = serializer.serialize(createFiscalXmlSnapshot('INVOICE')).xml;
    const material = createTestSigningMaterial();

    const signedXml = await signer.sign(xml, material.certificate);
    const duplicatedSignature = signedXml.replace(
      '</FacturaElectronica>',
      '<ds:Signature/></FacturaElectronica>',
    );
    const verification = await signer.verify(duplicatedSignature);

    expect(verification.isValid).toBe(false);
    expect(verification.validationErrors).toContain('FISCAL_XML_SIGNATURE_COUNT_INVALID');
  });

  it('rejects signing material with an incorrect passphrase', async () => {
    const xml = serializer.serialize(createFiscalXmlSnapshot('INVOICE')).xml;
    const material = createTestSigningMaterial();

    await expect(
      signer.sign(xml, { ...material.certificate, passphrase: 'wrong-passphrase' }),
    ).rejects.toThrow('INVALID_CERTIFICATE_PASSWORD');
  });
});

// ── Official Hacienda v4.4 policy structure tests ─────────────────────────────
//
// These tests pin the generated signature against the OFFICIAL Hacienda v4.4
// signature structure from ANEXOS_Y_ESTRUCTURAS_V4.4.pdf, Anexo 2
// ("Ejemplo de la etiqueta de firma y su contenido", pages 87-88).
//
// Authoritative values come exclusively from HACIENDA_V44_XADES_CONTRACT,
// which is independently verified against the official policy PDF on disk.

describe('NodeXadesEpesSignerAdapter — Hacienda v4.4 official policy structure', () => {
  const serializer = new HaciendaV44XmlSerializerAdapter();
  const signer = new NodeXadesEpesSignerAdapter();
  const xsdValidator = new Xsd11ValidatorAdapter();
  const standardsVerifier = new XmlCryptoXadesVerifier();

  interface PolicyRegion {
    // Policy / identifier
    signaturePolicyIdentifierPresent: boolean;
    sigPolicyIdPresent: boolean;
    sigPolicyHashPresent: boolean;
    identifierValue: string;
    identifierHasPercent: boolean;
    policyHashAlg: string;
    policyHashValue: string;
    descriptionPresent: boolean;
    // IDs and references
    signatureId: string;
    signatureValueId: string;
    documentRefId: string;
    documentRefType: string;
    signedPropertiesId: string;
    signedPropertiesRefUri: string;
    qualifyingPropertiesTarget: string;
    dataObjectFormatRef: string;
    // Cert
    certDigestAlg: string;
    certDigestValue: string;
    issuerSerialPresent: boolean;
    issuerName: string;
    issuerSerial: string;
    // DataObjectFormat
    dataObjectFormatPresent: boolean;
    mimeType: string;
  }

  function parsePolicyRegion(signedXml: string): PolicyRegion {
    const parser = new DOMParser({ errorHandler: () => undefined });
    const doc = parser.parseFromString(signedXml, 'application/xml');

    const getSingleText = (tag: string): string => {
      const el = doc.getElementsByTagName(tag)[0];
      return el?.firstChild?.nodeValue?.trim() ?? '(absent)';
    };
    const getSingleAttr = (tag: string, attr: string): string => {
      const el = doc.getElementsByTagName(tag)[0];
      return (el as unknown as Element)?.getAttribute?.(attr) ?? '(absent)';
    };

    // Isolated extractions using regex to avoid DOM ordering issues
    const phAlgM = signedXml.match(/SigPolicyHash[\s\S]*?<ds:DigestMethod[^/]*Algorithm="([^"]+)"/);
    const phValM = signedXml.match(/SigPolicyHash[\s\S]*?<ds:DigestValue>([^<]+)<\/ds:DigestValue>/);
    const cdAlgM = signedXml.match(/CertDigest[\s\S]*?<ds:DigestMethod[^/]*Algorithm="([^"]+)"/);
    const cdValM = signedXml.match(/CertDigest[\s\S]*?<ds:DigestValue>([^<]+)<\/ds:DigestValue>/);
    const dofRefM = signedXml.match(/DataObjectFormat\s+ObjectReference="([^"]+)"/);
    const mimeM = signedXml.match(/<xades:MimeType>([^<]+)<\/xades:MimeType>/);

    // Signature element attrs
    const sigEl = doc.getElementsByTagName('ds:Signature')[0] as unknown as Element;
    const svEl = doc.getElementsByTagName('ds:SignatureValue')[0] as unknown as Element;
    const refEls = Array.from(doc.getElementsByTagName('ds:Reference')) as unknown as Element[];
    const spEl = doc.getElementsByTagName('xades:SignedProperties')[0] as unknown as Element;
    const qpEl = doc.getElementsByTagName('xades:QualifyingProperties')[0] as unknown as Element;
    const refSpEl = refEls.find(r =>
      r.getAttribute('Type') === HACIENDA_V44_XADES_CONTRACT.signedPropertiesReferenceType,
    );
    const docRefEl = refEls.find(r =>
      r.getAttribute('Type') !== HACIENDA_V44_XADES_CONTRACT.signedPropertiesReferenceType,
    );

    return {
      signaturePolicyIdentifierPresent: signedXml.includes('SignaturePolicyIdentifier'),
      sigPolicyIdPresent: signedXml.includes('<xades:SigPolicyId>'),
      sigPolicyHashPresent: signedXml.includes('SigPolicyHash'),
      identifierValue: getSingleText('xades:Identifier'),
      identifierHasPercent: getSingleText('xades:Identifier').includes('%'),
      policyHashAlg: phAlgM?.[1] ?? '(absent)',
      policyHashValue: phValM?.[1]?.trim() ?? '(absent)',
      descriptionPresent: signedXml.includes('<xades:Description'),
      // IDs
      signatureId: sigEl?.getAttribute?.('Id') ?? '(absent)',
      signatureValueId: svEl?.getAttribute?.('Id') ?? '(absent)',
      documentRefId: docRefEl?.getAttribute?.('Id') ?? '(absent)',
      documentRefType: docRefEl?.getAttribute?.('Type') ?? '(absent)',
      signedPropertiesId: spEl?.getAttribute?.('Id') ?? '(absent)',
      signedPropertiesRefUri: refSpEl?.getAttribute?.('URI') ?? '(absent)',
      qualifyingPropertiesTarget: qpEl?.getAttribute?.('Target') ?? '(absent)',
      dataObjectFormatRef: dofRefM?.[1] ?? '(absent)',
      // Cert digest
      certDigestAlg: cdAlgM?.[1] ?? '(absent)',
      certDigestValue: cdValM?.[1]?.trim() ?? '(absent)',
      issuerSerialPresent: signedXml.includes('xades:IssuerSerial'),
      issuerName: getSingleText('ds:X509IssuerName'),
      issuerSerial: getSingleText('ds:X509SerialNumber'),
      // DataObjectFormat
      dataObjectFormatPresent: signedXml.includes('DataObjectFormat'),
      mimeType: mimeM?.[1] ?? '(absent)',
    };
  }

  let signedXml: string;
  let policy: PolicyRegion;
  let material: ReturnType<typeof createTestSigningMaterial>;

  beforeAll(async () => {
    material = createTestSigningMaterial();
    const xml = new HaciendaV44XmlSerializerAdapter()
      .serialize(createFiscalXmlSnapshot('INVOICE')).xml;
    signedXml = await signer.sign(xml, material.certificate);
    policy = parsePolicyRegion(signedXml);
  });

  // ── Policy presence ──────────────────────────────────────────────────────────
  it('SignaturePolicyIdentifier is present', () => {
    expect(policy.signaturePolicyIdentifierPresent).toBe(true);
  });

  it('SigPolicyId is present', () => {
    expect(policy.sigPolicyIdPresent).toBe(true);
  });

  it('SigPolicyHash is present', () => {
    expect(policy.sigPolicyHashPresent).toBe(true);
  });

  // ── Policy Identifier — official v4.4 value ──────────────────────────────────
  it('Identifier is the official percent-encoded URL from Anexo 2', () => {
    expect(policy.identifierValue).toBe(HACIENDA_V44_XADES_CONTRACT.signaturePolicyDocumentUrl);
  });

  it('Identifier uses percent-encoding (official Anexo 2 form, not raw UTF-8)', () => {
    expect(policy.identifierHasPercent).toBe(true);
    expect(policy.identifierValue).toContain('%C3%B3'); // ó
    expect(policy.identifierValue).toContain('%C3%A9'); // é
  });

  it('Identifier is not the URLXXXXV4.4 placeholder', () => {
    expect(policy.identifierValue.toUpperCase()).not.toContain('URLXXXXV4.4');
  });

  // ── Policy hash — official SHA-256 per Anexo 2 ──────────────────────────────
  it('SigPolicyHash DigestMethod is SHA-256 (official Anexo 2 requirement)', () => {
    expect(policy.policyHashAlg).toBe(HACIENDA_V44_XADES_CONTRACT.digestMethodAlgorithm);
    expect(policy.policyHashAlg).toBe('http://www.w3.org/2001/04/xmlenc#sha256');
  });

  it('SigPolicyHash DigestValue equals the official Anexo 2 value', () => {
    expect(policy.policyHashValue).toBe(
      HACIENDA_V44_XADES_CONTRACT.signaturePolicyDocumentSha256Base64,
    );
    // Explicit pin of the official value confirmed in ANEXOS_Y_ESTRUCTURAS_V4.4.pdf
    expect(policy.policyHashValue).toBe('DWxin1xWOeI8OuWQXazh4VjLWAaCLAA954em7DMh0h8=');
  });

  it('SigPolicyHash DigestValue is 44-char base64 (32-byte SHA-256)', () => {
    expect(policy.policyHashValue.length).toBe(44);
    expect(Buffer.from(policy.policyHashValue, 'base64').length).toBe(32);
    expect(policy.policyHashValue).not.toMatch(/^[0-9a-f]{64}$/); // not the hex form
  });

  it('SigPolicyHash DigestValue independently verified against policy PDF on disk', () => {
    const path = require('path') as typeof import('path');
    const cryptoMod = require('crypto') as typeof import('crypto');
    const fsMod = require('fs') as typeof import('fs');
    const pdfPath = path.join(
      process.cwd(), 'resources', 'hacienda', 'v4.4',
      HACIENDA_V44_XADES_CONTRACT.signaturePolicyDocumentFileName,
    );
    const fileHashBase64 = cryptoMod
      .createHash('sha256')
      .update(fsMod.readFileSync(pdfPath))
      .digest('base64');
    expect(policy.policyHashValue).toBe(fileHashBase64);
  });

  it('No xades:Description element (not in official Anexo 2 example)', () => {
    expect(policy.descriptionPresent).toBe(false);
  });

  // ── ID / reference structure — official Anexo 2 patterns ────────────────────
  it('ds:Signature Id follows id-{hexUUID} pattern from Anexo 2', () => {
    expect(policy.signatureId).toMatch(/^id-[0-9a-f]{32}$/);
  });

  it('ds:SignatureValue Id follows value-id{hexUUID} pattern from Anexo 2', () => {
    expect(policy.signatureValueId).toMatch(/^value-id[0-9a-f]{32}$/);
  });

  it('Document Reference Id is r-id-1 as in official Anexo 2', () => {
    expect(policy.documentRefId).toBe('r-id-1');
  });

  it('Document Reference Type is empty string as in official Anexo 2', () => {
    expect(policy.documentRefType).toBe('');
  });

  it('xades:SignedProperties Id follows xades-id-{hexUUID} pattern from Anexo 2', () => {
    expect(policy.signedPropertiesId).toMatch(/^xades-id-[0-9a-f]{32}$/);
  });

  it('SignedProperties Reference URI resolves to #xades-id-{hexUUID}', () => {
    expect(policy.signedPropertiesRefUri).toBe(`#${policy.signedPropertiesId}`);
  });

  it('QualifyingProperties Target resolves to #id-{hexUUID} of the ds:Signature', () => {
    expect(policy.qualifyingPropertiesTarget).toBe(`#${policy.signatureId}`);
  });

  it('All UUIDs in a single signature share the same hexUUID root', () => {
    const sigHex = policy.signatureId.slice(3);       // strip 'id-'
    const svHex  = policy.signatureValueId.slice(8);  // strip 'value-id'
    const spHex  = policy.signedPropertiesId.slice(9); // strip 'xades-id-'
    expect(sigHex).toBe(svHex);
    expect(sigHex).toBe(spHex);
  });

  // ── CertDigest — official Anexo 2: SHA-1 for certificate fingerprint ─────────
  it('CertDigest DigestMethod is SHA-1 per official Anexo 2 example', () => {
    expect(policy.certDigestAlg).toBe(HACIENDA_V44_XADES_CONTRACT.certDigestAlgorithm);
    expect(policy.certDigestAlg).toBe('http://www.w3.org/2000/09/xmldsig#sha1');
  });

  it('CertDigest DigestValue is 28-char base64 (20-byte SHA-1 of cert DER)', () => {
    expect(policy.certDigestValue.length).toBe(28);
    expect(Buffer.from(policy.certDigestValue, 'base64').length).toBe(20);
  });

  it('CertDigest DigestValue is independently verified against the test certificate', () => {
    const certDer = Buffer.from(material.certificateDerBase64, 'base64');
    const expected = crypto.createHash('sha1').update(certDer).digest('base64');
    expect(policy.certDigestValue).toBe(expected);
  });

  // ── IssuerSerial — required by official Anexo 2 ──────────────────────────────
  it('xades:IssuerSerial is present', () => {
    expect(policy.issuerSerialPresent).toBe(true);
  });

  it('ds:X509IssuerName is present and non-empty', () => {
    expect(policy.issuerName).not.toBe('(absent)');
    expect(policy.issuerName.length).toBeGreaterThan(0);
  });

  it('ds:X509SerialNumber is present and is a positive decimal integer', () => {
    expect(policy.issuerSerial).not.toBe('(absent)');
    expect(policy.issuerSerial).toMatch(/^\d+$/);
    expect(Number(policy.issuerSerial)).toBeGreaterThan(0);
  });

  it('IssuerSerial values are derived from the actual signing certificate (not hardcoded)', () => {
    const certDer = Buffer.from(material.certificateDerBase64, 'base64');
    const x509 = new crypto.X509Certificate(certDer);
    const expectedSerial = BigInt('0x' + x509.serialNumber).toString(10);
    const expectedIssuer = x509.issuer.split('\n').filter(s => s.length > 0).join(',');
    expect(policy.issuerSerial).toBe(expectedSerial);
    expect(policy.issuerName).toBe(expectedIssuer);
  });

  // ── DataObjectFormat — required by official Anexo 2 ──────────────────────────
  it('xades:DataObjectFormat is present', () => {
    expect(policy.dataObjectFormatPresent).toBe(true);
  });

  it('DataObjectFormat ObjectReference resolves to #r-id-1 (document Reference)', () => {
    expect(policy.dataObjectFormatRef).toBe('#r-id-1');
  });

  it('MimeType is application/octet-stream per official Anexo 2', () => {
    expect(policy.mimeType).toBe(HACIENDA_V44_XADES_CONTRACT.dataObjectMimeType);
    expect(policy.mimeType).toBe('application/octet-stream');
  });

  // ── SHA-1 guard ──────────────────────────────────────────────────────────────
  it('SHA-1 is absent everywhere except in xades:CertDigest', () => {
    const withoutCertDigest = signedXml.replace(
      /<xades:CertDigest>[\s\S]*?<\/xades:CertDigest>/gi,
      '',
    );
    expect(withoutCertDigest.toLowerCase()).not.toContain('xmldsig#sha1');
    expect(withoutCertDigest.toLowerCase()).not.toContain('rsa-sha1');
  });

  it('xades:CertDigest legitimately contains SHA-1 per official Anexo 2', () => {
    const certDigestBlock = signedXml.match(
      /<xades:CertDigest>[\s\S]*?<\/xades:CertDigest>/i,
    )?.[0] ?? '';
    expect(certDigestBlock).toContain('xmldsig#sha1');
  });

  // ── Cryptographic verification ────────────────────────────────────────────────
  it('signature still verifies cryptographically with official v4.4 structure', async () => {
    const verification = await signer.verify(signedXml);
    expect(verification.isValid).toBe(true);
    expect(verification.validationErrors).toEqual([]);
  });

  it('independent xml-crypto verifier confirms signature valid', () => {
    const result = standardsVerifier.verify(signedXml);
    expect(result.isValid).toBe(true);
  });

  it('generated XML still passes official Hacienda XSD v4.4 validation', () => {
    const original = serializer.serialize(createFiscalXmlSnapshot('INVOICE'));
    const xsdResult = xsdValidator.validate({ ...original, xml: signedXml });
    expect(xsdResult).toMatchObject({ isValid: true });
  });

  it('SignedProperties reference is present', () => {
    expect(signedXml).toContain('SignedProperties');
  });
});
