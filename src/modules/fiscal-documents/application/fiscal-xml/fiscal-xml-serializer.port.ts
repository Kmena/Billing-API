import {
  FiscalXmlDocumentSnapshot,
  FiscalXmlGenerationResult,
} from '../../domain/fiscal-xml/fiscal-xml.types';

export interface FiscalXmlSerializerPort {
  serialize(document: FiscalXmlDocumentSnapshot): FiscalXmlGenerationResult;
}

export const FISCAL_XML_SERIALIZER = Symbol('FiscalXmlSerializerPort');
