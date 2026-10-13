import { createHash, timingSafeEqual } from 'crypto';
import { DOMParser, Document, Element, Node } from '@xmldom/xmldom';
import { HACIENDA_V44_XADES_CONTRACT } from '../../domain/fiscal-xml/hacienda-v44-contract';
import { FiscalRepresentationProjectionBuilder } from './fiscal-representation-projection.builder';

export const SIGNED_XML_MAX_SIZE_BYTES = 2 * 1024 * 1024;
export const SIGNED_XML_MAX_DEPTH = 64;
export const SIGNED_XML_MAX_NODES = 50_000;
export const SIGNED_XML_MAX_TEXT_NODE_CHARS = 20_000;
export const SIGNED_XML_MAX_TOTAL_TEXT_CHARS = 1_500_000;

const DIGITAL_SIGNATURE_NAMESPACE = 'http://www.w3.org/2000/09/xmldsig#';
const XADES_NAMESPACE = HACIENDA_V44_XADES_CONTRACT.xadesNamespace;
const ROOTS = {
  INVOICE: {
    root: 'FacturaElectronica',
    namespace: 'https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/facturaElectronica',
  },
  TICKET: {
    root: 'TiqueteElectronico',
    namespace: 'https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/tiqueteElectronico',
  },
} as const;

export type FiscalDocumentType = keyof typeof ROOTS;
export type FiscalDecimal = Readonly<{ canonical: string }>;
export type FiscalIdentificationView = Readonly<{ type?: string; number?: string }>;
export type FiscalLocationView = Readonly<{
  province?: string;
  canton?: string;
  district?: string;
  neighborhood?: string;
  otherSigns?: string;
  foreignOtherSigns?: string;
}>;
export type FiscalPhoneView = Readonly<{ countryCode: string; number: string }>;
export type FiscalPartyView = Readonly<{
  legalName?: string;
  commercialName?: string;
  identification?: FiscalIdentificationView;
  foreignIdentification?: string;
  fiscalRegistry8707?: string;
  location?: FiscalLocationView;
  phone?: FiscalPhoneView;
  email?: string;
  economicActivity?: string;
}>;
export type FiscalCommercialCodeView = Readonly<{ type: string; code: string }>;
export type FiscalDiscountView = Readonly<{
  amount: FiscalDecimal;
  code: string;
  otherCode?: string;
  nature?: string;
}>;
export type FiscalSpecificTaxView = Readonly<{
  quantityUnit: FiscalDecimal;
  percentage?: FiscalDecimal;
  proportion?: FiscalDecimal;
  consumptionUnitVolume?: FiscalDecimal;
  taxPerUnit: FiscalDecimal;
}>;
export type FiscalExemptionView = Readonly<{
  documentType: string;
  otherDocumentType?: string;
  documentNumber: string;
  article?: string;
  clause?: string;
  institutionName: string;
  otherInstitutionName?: string;
  issuedAt: string;
  exemptRate: FiscalDecimal;
  exemptAmount: FiscalDecimal;
}>;
export type FiscalTaxView = Readonly<{
  code: string;
  otherCode?: string;
  tariffCode?: string;
  rate?: FiscalDecimal;
  vatCalculationFactor?: FiscalDecimal;
  specificTax?: FiscalSpecificTaxView;
  amount: FiscalDecimal;
  exemption?: FiscalExemptionView;
}>;
export type FiscalLineView = Readonly<{
  number: string;
  cabys: string;
  commercialCodes: readonly FiscalCommercialCodeView[];
  quantity: FiscalDecimal;
  unit: string;
  commercialUnit?: string;
  transactionType?: string;
  detail: string;
  vinOrSerialNumbers: readonly string[];
  unitPrice: FiscalDecimal;
  total: FiscalDecimal;
  discounts: readonly FiscalDiscountView[];
  subtotal: FiscalDecimal;
  vatCollectedAtFactory?: string;
  taxableBase?: FiscalDecimal;
  issuerAssumedFactoryTax?: FiscalDecimal;
  taxNet: FiscalDecimal;
  lineTotal: FiscalDecimal;
  medicationRegistration?: string;
  pharmaceuticalForm?: string;
  taxes: readonly FiscalTaxView[];
  bundleFields: readonly FiscalProjectedField[];
}>;
export type FiscalPaymentView = Readonly<{
  type: string;
  otherType?: string;
  total: FiscalDecimal;
}>;
export type FiscalOtherChargeView = Readonly<{
  documentType: string;
  otherDocumentType?: string;
  thirdPartyId?: string;
  thirdPartyName?: string;
  detail: string;
  percentage?: FiscalDecimal;
  amount: FiscalDecimal;
}>;
export type FiscalReferenceView = Readonly<{
  documentType: string;
  otherDocumentType?: string;
  number: string;
  issuedAt: string;
  code: string;
  otherCode?: string;
  reason: string;
}>;
export type FiscalProjectedField = Readonly<{
  path: string;
  elementName: string;
  value: string;
  order: number;
}>;
export type FiscalRepresentationView = Readonly<{
  contractVersion: '1.0';
  source: Readonly<{
    signedXmlSha256: string;
    schemaNamespace: string;
    documentType: FiscalDocumentType;
  }>;
  document: Readonly<{
    type: FiscalDocumentType;
    clave: string;
    systemProviderId: string;
    issuerActivityCode: string;
    receiverActivityCode?: string;
    consecutive: string;
    issueDate: string;
  }>;
  issuer: FiscalPartyView & Readonly<{ legalName: string }>;
  receiver?: FiscalPartyView;
  sale: Readonly<{ condition: string; otherCondition?: string; creditTerm?: string }>;
  currency: Readonly<{ code: string; exchangeRate: FiscalDecimal }>;
  payments: readonly FiscalPaymentView[];
  lines: readonly FiscalLineView[];
  summary: Readonly<{
    gross: FiscalDecimal;
    discounts?: FiscalDecimal;
    net: FiscalDecimal;
    tax?: FiscalDecimal;
    total: FiscalDecimal;
    values: Readonly<Partial<Record<FiscalSummaryField, FiscalDecimal>>>;
    taxBreakdown: readonly Readonly<{
      code: string;
      tariffCode?: string;
      amount: FiscalDecimal;
    }>[];
  }>;
  otherCharges: readonly FiscalOtherChargeView[];
  references: readonly FiscalReferenceView[];
  otherInformation: readonly string[];
  projectedFields: readonly FiscalProjectedField[];
}>;

export type FiscalSummaryField =
  | 'TotalServGravados'
  | 'TotalServExentos'
  | 'TotalServExonerado'
  | 'TotalServNoSujeto'
  | 'TotalMercanciasGravadas'
  | 'TotalMercanciasExentas'
  | 'TotalMercExonerada'
  | 'TotalMercNoSujeta'
  | 'TotalGravado'
  | 'TotalExento'
  | 'TotalExonerado'
  | 'TotalNoSujeto'
  | 'TotalVenta'
  | 'TotalDescuentos'
  | 'TotalVentaNeta'
  | 'TotalImpuesto'
  | 'TotalImpAsumEmisorFabrica'
  | 'TotalIVADevuelto'
  | 'TotalOtrosCargos'
  | 'TotalComprobante';

export class FiscalXmlProjectionError extends Error {
  constructor(
    readonly code:
      | 'SIGNED_XML_HASH_MISMATCH'
      | 'SIGNED_XML_OVERSIZED'
      | 'XML_MALFORMED'
      | 'XML_SECURITY_REJECTED'
      | 'XML_UNSUPPORTED_ROOT'
      | 'XML_NAMESPACE_INVALID'
      | 'PROJECTION_FAILED',
    message: string,
  ) {
    super(message);
  }
}

export class ReadOnlyFiscalXmlParser {
  project(
    input: Readonly<{ bytes: Buffer; expectedSha256: string; documentType: FiscalDocumentType }>,
  ): FiscalRepresentationView {
    if (input.bytes.length > SIGNED_XML_MAX_SIZE_BYTES)
      throw new FiscalXmlProjectionError(
        'SIGNED_XML_OVERSIZED',
        'Signed XML exceeds the configured byte limit.',
      );
    const actualHash = createHash('sha256').update(input.bytes).digest('hex');
    if (!this.sameHash(actualHash, input.expectedSha256))
      throw new FiscalXmlProjectionError(
        'SIGNED_XML_HASH_MISMATCH',
        'Signed XML hash does not match the stored artifact hash.',
      );
    let xml: string;
    try {
      xml = new TextDecoder('utf-8', { fatal: true }).decode(input.bytes);
    } catch {
      throw new FiscalXmlProjectionError('XML_MALFORMED', 'Signed XML is not valid UTF-8.');
    }
    if (
      /<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml) ||
      /&(?!(?:amp|lt|gt|quot|apos);|#\d+;|#x[\da-f]+;)/i.test(xml)
    )
      throw new FiscalXmlProjectionError(
        'XML_SECURITY_REJECTED',
        'DTD, entities, CDATA, or undeclared entity references are forbidden.',
      );
    let document: Document;
    try {
      document = new DOMParser({
        onError: (level: string, message: string) => {
          throw new Error(`${level}:${message}`);
        },
      }).parseFromString(xml, 'application/xml');
    } catch {
      throw new FiscalXmlProjectionError('XML_MALFORMED', 'Signed XML is malformed.');
    }
    if (document.documentElement?.localName === 'parsererror')
      throw new FiscalXmlProjectionError('XML_MALFORMED', 'Signed XML is malformed.');
    const expected = ROOTS[input.documentType];
    const root = document.documentElement;
    if (!root || root.localName !== expected.root)
      throw new FiscalXmlProjectionError('XML_UNSUPPORTED_ROOT', 'Signed XML root is unsupported.');
    if (root.namespaceURI !== expected.namespace)
      throw new FiscalXmlProjectionError(
        'XML_NAMESPACE_INVALID',
        'Signed XML namespace is invalid.',
      );
    this.assertBounds(root, expected.namespace);
    return new FiscalRepresentationProjectionBuilder().build(root, input.documentType, actualHash);
  }

  private assertBounds(root: Element, namespace: string): void {
    const allowedNamespaces = new Set([namespace, DIGITAL_SIGNATURE_NAMESPACE, XADES_NAMESPACE]);
    const queue: Array<Readonly<{ node: Node; depth: number }>> = [{ node: root, depth: 1 }];
    let nodes = 0;
    let allText = 0;
    while (queue.length) {
      const { node, depth } = queue.pop()!;
      if (++nodes > SIGNED_XML_MAX_NODES || depth > SIGNED_XML_MAX_DEPTH)
        throw new FiscalXmlProjectionError(
          'XML_SECURITY_REJECTED',
          'Signed XML structural limit exceeded.',
        );
      if (node.nodeType === 1 && !allowedNamespaces.has((node as Element).namespaceURI ?? ''))
        throw new FiscalXmlProjectionError(
          'XML_NAMESPACE_INVALID',
          'Nested XML namespace is invalid.',
        );
      if (
        depth > 1 &&
        node.nodeType === 1 &&
        ((node as Element).localName === ROOTS.INVOICE.root ||
          (node as Element).localName === ROOTS.TICKET.root)
      )
        throw new FiscalXmlProjectionError(
          'XML_SECURITY_REJECTED',
          'Nested fiscal document roots are forbidden.',
        );
      if (node.nodeType === 3) {
        const size = node.nodeValue?.length ?? 0;
        if (
          size > SIGNED_XML_MAX_TEXT_NODE_CHARS ||
          (allText += size) > SIGNED_XML_MAX_TOTAL_TEXT_CHARS
        )
          throw new FiscalXmlProjectionError(
            'XML_SECURITY_REJECTED',
            'Signed XML text limit exceeded.',
          );
      }
      for (let child = node.lastChild; child; child = child.previousSibling)
        queue.push({ node: child, depth: depth + 1 });
    }
  }

  private sameHash(actual: string, expected: string): boolean {
    return (
      /^[a-f\d]{64}$/i.test(expected) &&
      timingSafeEqual(Buffer.from(actual), Buffer.from(expected.toLowerCase()))
    );
  }
}
