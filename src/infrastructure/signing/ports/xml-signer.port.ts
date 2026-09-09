/**
 * XmlSignerPort — Interface for XAdES-EPES XML digital signature.
 * ADR-005: Technical spike pending — do not commit to implementation until spike results.
 * This interface is defined in Fase 0 to lock the contract before Fase 3.
 */
export interface Pkcs12Certificate {
  readonly data: Buffer;
  readonly passphrase: string;
}

export interface SignatureVerificationResult {
  readonly isValid: boolean;
  readonly signerName?: string;
  readonly signedAt?: Date;
  readonly validationErrors: string[];
}

export interface XmlSignerPort {
  /**
   * Signs an XML document using XAdES-EPES format.
   * @param xmlDocument The raw XML document string to sign
   * @param certificate The PKCS#12 certificate (from Hacienda) — NEVER log or store
   */
  sign(xmlDocument: string, certificate: Pkcs12Certificate): Promise<string>;

  /**
   * Verifies an XML signature.
   * @param signedXml The signed XML document string
   */
  verify(signedXml: string): Promise<SignatureVerificationResult>;
}

export const XML_SIGNER = Symbol('XmlSignerPort');
