import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  HACIENDA_V44_CONTRACT_ASSETS,
  HACIENDA_V44_FACTURA_ELECTRONICA,
  HACIENDA_V44_SCHEMA_VERSION,
  HACIENDA_V44_TIQUETE_ELECTRONICO,
  HACIENDA_V44_XADES_CONTRACT,
} from '../hacienda-v44-contract';

const resourcePath = (...parts: string[]): string =>
  path.join(process.cwd(), 'resources', 'hacienda', 'v4.4', ...parts);

const sha256File = (filePath: string): string =>
  crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');

describe('Hacienda v4.4 contract assets', () => {
  it('pins the official FE and TE schema version', () => {
    expect(HACIENDA_V44_SCHEMA_VERSION).toBe('v4.4');
    expect(HACIENDA_V44_FACTURA_ELECTRONICA.namespace).toBe(
      'https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/facturaElectronica',
    );
    expect(HACIENDA_V44_TIQUETE_ELECTRONICO.namespace).toBe(
      'https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/tiqueteElectronico',
    );
  });

  it('keeps pinned XSD checksums and target namespaces aligned with downloaded assets', () => {
    for (const asset of HACIENDA_V44_CONTRACT_ASSETS) {
      const filePath = resourcePath(asset.xsdFileName);
      const content = fs.readFileSync(filePath, 'utf8');
      const stats = fs.statSync(filePath);

      expect(stats.size).toBe(asset.fileSizeBytes);
      expect(sha256File(filePath)).toBe(asset.sha256);
      expect(content).toContain(`targetNamespace="${asset.namespace}"`);
      expect(content).toContain('version="4.4"');
    }
  });

  it('records the verified XAdES-EPES enveloped signature contract without SHA-1 or placeholders', () => {
    expect(HACIENDA_V44_XADES_CONTRACT.profile).toBe('XAdES-EPES');
    expect(HACIENDA_V44_XADES_CONTRACT.packaging).toBe('ENVELOPED');
    expect(HACIENDA_V44_XADES_CONTRACT.xadesNamespace).toBe('http://uri.etsi.org/01903/v1.3.2#');
    expect(HACIENDA_V44_XADES_CONTRACT.canonicalizationAlgorithm).toBe(
      'http://www.w3.org/2001/10/xml-exc-c14n#',
    );
    expect(HACIENDA_V44_XADES_CONTRACT.signatureMethodAlgorithm).toBe(
      'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    );
    expect(HACIENDA_V44_XADES_CONTRACT.digestMethodAlgorithm).toBe(
      'http://www.w3.org/2001/04/xmlenc#sha256',
    );
    expect(HACIENDA_V44_XADES_CONTRACT.primaryReferenceUri).toBe('');
    expect(HACIENDA_V44_XADES_CONTRACT.primaryReferenceTransforms).toEqual([
      {
        algorithm: 'http://www.w3.org/TR/1999/REC-xpath-19991116',
        xpath: 'not(ancestor-or-self::ds:Signature)',
      },
      {
        algorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
      },
    ]);
    expect(HACIENDA_V44_XADES_CONTRACT.signedPropertiesReferenceType).toBe(
      'http://uri.etsi.org/01903#SignedProperties',
    );
    expect(HACIENDA_V44_XADES_CONTRACT.signedPropertiesTransformAlgorithm).toBe(
      'http://www.w3.org/2001/10/xml-exc-c14n#',
    );
    expect(HACIENDA_V44_XADES_CONTRACT.signaturePolicyDocumentUrl).not.toContain('URLXXXXV4.4');

    // Algorithms used for signing/document/policy digests must not contain SHA-1
    const configuredAlgorithms = [
      HACIENDA_V44_XADES_CONTRACT.canonicalizationAlgorithm,
      HACIENDA_V44_XADES_CONTRACT.signatureMethodAlgorithm,
      HACIENDA_V44_XADES_CONTRACT.digestMethodAlgorithm,
      ...HACIENDA_V44_XADES_CONTRACT.primaryReferenceTransforms.map(
        (transform) => transform.algorithm,
      ),
      HACIENDA_V44_XADES_CONTRACT.signedPropertiesTransformAlgorithm,
    ]
      .join('|')
      .toLowerCase();

    expect(configuredAlgorithms).not.toContain('sha1');
    expect(configuredAlgorithms).not.toContain('rsa-sha1');
    expect(HACIENDA_V44_XADES_CONTRACT.prohibitedAlgorithms).toContain('sha1');
    expect(HACIENDA_V44_XADES_CONTRACT.prohibitedAlgorithms).toContain('rsa-sha1');
  });

  // ── CertDigest SHA-1 (official Hacienda v4.4 Anexo 2 requirement) ───────────
  it('certDigestAlgorithm is SHA-1 as required by Hacienda v4.4 Anexo 2', () => {
    // Source: ANEXOS_Y_ESTRUCTURAS_V4.4.pdf, Anexo 2
    //         "Ejemplo de la etiqueta de firma y su contenido" (pages 87-88)
    expect(HACIENDA_V44_XADES_CONTRACT.certDigestAlgorithm).toBe(
      'http://www.w3.org/2000/09/xmldsig#sha1',
    );
  });

  it('certDigestAlgorithm is in the prohibitedAlgorithms list (enforced only outside CertDigest)', () => {
    // SHA-1 is prohibited everywhere except CertDigest. The contract records it in
    // prohibitedAlgorithms so that guards can detect accidental SHA-1 use in
    // signing/document digests. The signer strips CertDigest before applying the guard.
    expect(HACIENDA_V44_XADES_CONTRACT.prohibitedAlgorithms).toContain(
      HACIENDA_V44_XADES_CONTRACT.certDigestAlgorithm,
    );
  });

  // ── Policy document ──────────────────────────────────────────────────────────
  it('pins the official signature-policy document hash (hex)', () => {
    const filePath = resourcePath(HACIENDA_V44_XADES_CONTRACT.signaturePolicyDocumentFileName);
    const stats = fs.statSync(filePath);

    expect(stats.size).toBe(HACIENDA_V44_XADES_CONTRACT.signaturePolicyDocumentFileSizeBytes);
    expect(sha256File(filePath)).toBe(HACIENDA_V44_XADES_CONTRACT.signaturePolicyDocumentSha256);
  });

  it('signaturePolicyDocumentSha256Base64 is the correct base64 encoding of the hex hash', () => {
    // XML-DSIG requires <ds:DigestValue> to be base64-encoded binary, NOT hex.
    const derivedBase64 = Buffer.from(
      HACIENDA_V44_XADES_CONTRACT.signaturePolicyDocumentSha256,
      'hex',
    ).toString('base64');
    expect(derivedBase64).toBe(HACIENDA_V44_XADES_CONTRACT.signaturePolicyDocumentSha256Base64);
    // Must decode back to exactly 32 bytes (SHA-256 output length)
    expect(Buffer.from(derivedBase64, 'base64').length).toBe(32);
    // Explicit value guard — pins the official v4.4 Anexo 2 value exactly
    expect(HACIENDA_V44_XADES_CONTRACT.signaturePolicyDocumentSha256Base64).toBe(
      'DWxin1xWOeI8OuWQXazh4VjLWAaCLAA954em7DMh0h8=',
    );
    expect(HACIENDA_V44_XADES_CONTRACT.signaturePolicyDocumentSha256Base64Length).toBe(44);
  });

  it('signaturePolicyDocumentSha256Base64 is verified against the real policy PDF on disk', () => {
    const filePath = resourcePath(HACIENDA_V44_XADES_CONTRACT.signaturePolicyDocumentFileName);
    const fileHashBase64 = crypto
      .createHash('sha256')
      .update(fs.readFileSync(filePath))
      .digest('base64');
    expect(fileHashBase64).toBe(HACIENDA_V44_XADES_CONTRACT.signaturePolicyDocumentSha256Base64);
  });

  // ── Policy URL format ────────────────────────────────────────────────────────
  it('signaturePolicyDocumentUrl is the percent-encoded form (official Anexo 2 example)', () => {
    // Source: ANEXOS_Y_ESTRUCTURAS_V4.4.pdf, Anexo 2 — <xades:Identifier> in official example
    const url = HACIENDA_V44_XADES_CONTRACT.signaturePolicyDocumentUrl;
    expect(url).toContain('%C3%B3'); // ó percent-encoded
    expect(url).toContain('%C3%A9'); // é percent-encoded
    expect(url).toBe(
      'https://cdn.comprobanteselectronicos.go.cr/xml-schemas/Resoluci%C3%B3n_General_sobre_disposiciones_t%C3%A9cnicas_comprobantes_electr%C3%B3nicos_para_efectos_tributarios.pdf',
    );
  });
});
