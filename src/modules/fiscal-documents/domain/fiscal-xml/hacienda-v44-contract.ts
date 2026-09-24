export const HACIENDA_V44_SCHEMA_VERSION = 'v4.4' as const;

export const HACIENDA_V44_FACTURA_ELECTRONICA = {
  documentType: 'INVOICE',
  rootElement: 'FacturaElectronica',
  namespace: 'https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/facturaElectronica',
  xsdFileName: 'FacturaElectronica.xsd',
  sourceUrl: 'https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/FacturaElectronica.xsd',
  fileSizeBytes: 118624,
  sha256: 'd384afef665573606f6499b2182d6070850ada8c93bc40fa7f0f3901a25b9cc8',
} as const;

export const HACIENDA_V44_TIQUETE_ELECTRONICO = {
  documentType: 'TICKET',
  rootElement: 'TiqueteElectronico',
  namespace: 'https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/tiqueteElectronico',
  xsdFileName: 'TiqueteElectronico.xsd',
  sourceUrl: 'https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/TiqueteElectronico.xsd',
  fileSizeBytes: 114029,
  sha256: 'aaa273b368997d47214c92455c22b851cb5ab6ef105dc571233268c1ef5fd6c7',
} as const;

export const HACIENDA_V44_XADES_CONTRACT = {
  profile: 'XAdES-EPES',
  packaging: 'ENVELOPED',
  xadesNamespace: 'http://uri.etsi.org/01903/v1.3.2#',
  xmlDsigNamespace: 'http://www.w3.org/2000/09/xmldsig#',
  canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
  signatureMethodAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
  digestMethodAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
  /**
   * SHA-1 algorithm used ONLY for <xades:CertDigest>.
   * Source: ANEXOS_Y_ESTRUCTURAS_V4.4.pdf, Anexo 2
   *         "Ejemplo de la etiqueta de firma y su contenido" (pages 87-88).
   * SHA-1 is otherwise prohibited throughout the signature.
   */
  certDigestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
  primaryReferenceUri: '',
  primaryReferenceTransforms: [
    {
      algorithm: 'http://www.w3.org/TR/1999/REC-xpath-19991116',
      xpath: 'not(ancestor-or-self::ds:Signature)',
    },
    {
      algorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
    },
  ],
  signedPropertiesReferenceType: 'http://uri.etsi.org/01903#SignedProperties',
  signedPropertiesTransformAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
  qualifyingPropertiesTarget: 'ds:Signature Id',
  /** MimeType for DataObjectFormat per official v4.4 example. */
  dataObjectMimeType: 'application/octet-stream',
  /**
   * Percent-encoded CDN URL for the official Hacienda signature policy document.
   * Used both for downloading the file and as the <xades:Identifier> value in the
   * XAdES-EPES signature.
   * Source: ANEXOS_Y_ESTRUCTURAS_V4.4.pdf, Anexo 2 — official v4.4 example.
   */
  signaturePolicyDocumentUrl:
    'https://cdn.comprobanteselectronicos.go.cr/xml-schemas/Resoluci%C3%B3n_General_sobre_disposiciones_t%C3%A9cnicas_comprobantes_electr%C3%B3nicos_para_efectos_tributarios.pdf',
  signaturePolicyDocumentFileName: 'signature-policy-v4.4.pdf',
  signaturePolicyDocumentFileSizeBytes: 163479,
  /**
   * SHA-256 of the official Hacienda signature-policy PDF, as hex.
   * Used by contract tests and infrastructure tooling to verify the local asset.
   * Do NOT put this hex value directly into <ds:DigestValue> — XML-DSIG requires
   * base64.  Use signaturePolicyDocumentSha256Base64 in the XAdES signature.
   */
  signaturePolicyDocumentSha256: '0d6c629f5c5639e23c3ae5905dace1e158cb5806822c003de787a6ec3321d21f',
  /**
   * Base64 encoding of the SHA-256 hash above.
   * This is the authoritative value for <ds:DigestValue> inside
   * <xades:SigPolicyHash> in the generated XAdES-EPES signature.
   *
   * Confirmed against:
   *   1. ANEXOS_Y_ESTRUCTURAS_V4.4.pdf Anexo 2 official example value.
   *   2. SHA-256 of the locally-pinned policy PDF (independent verification).
   *
   * Derivation:
   *   Buffer.from(signaturePolicyDocumentSha256, 'hex').toString('base64')
   *   === 'DWxin1xWOeI8OuWQXazh4VjLWAaCLAA954em7DMh0h8='
   */
  signaturePolicyDocumentSha256Base64: 'DWxin1xWOeI8OuWQXazh4VjLWAaCLAA954em7DMh0h8=',
  signaturePolicyDocumentSha256Base64Length: 44,
  /**
   * SHA-1 is prohibited for signing, document digests, and policy hash.
   * Exception: <xades:CertDigest> legitimately uses SHA-1 per the official
   * v4.4 spec (Anexo 2).  The signer strips CertDigest before enforcing this list.
   */
  prohibitedAlgorithms: ['sha1', 'rsa-sha1', 'http://www.w3.org/2000/09/xmldsig#sha1'],
  placeholderPolicyIdentifiers: ['URLXXXXV4.4'],
} as const;

export const HACIENDA_V44_CONTRACT_ASSETS = [
  HACIENDA_V44_FACTURA_ELECTRONICA,
  HACIENDA_V44_TIQUETE_ELECTRONICO,
] as const;
