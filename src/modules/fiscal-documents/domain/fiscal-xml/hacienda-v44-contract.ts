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
  signaturePolicyDocumentUrl:
    'https://cdn.comprobanteselectronicos.go.cr/xml-schemas/Resoluci%C3%B3n_General_sobre_disposiciones_t%C3%A9cnicas_comprobantes_electr%C3%B3nicos_para_efectos_tributarios.pdf',
  signaturePolicyDocumentFileName: 'signature-policy-v4.4.pdf',
  signaturePolicyDocumentFileSizeBytes: 163479,
  signaturePolicyDocumentSha256: '0d6c629f5c5639e23c3ae5905dace1e158cb5806822c003de787a6ec3321d21f',
  prohibitedAlgorithms: ['sha1', 'rsa-sha1', 'http://www.w3.org/2000/09/xmldsig#sha1'],
  placeholderPolicyIdentifiers: ['URLXXXXV4.4'],
} as const;

export const HACIENDA_V44_CONTRACT_ASSETS = [
  HACIENDA_V44_FACTURA_ELECTRONICA,
  HACIENDA_V44_TIQUETE_ELECTRONICO,
] as const;
