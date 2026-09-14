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
