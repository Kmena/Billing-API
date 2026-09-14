import {
  FiscalXmlGenerationResult,
  FiscalXmlValidationResult,
} from '../../domain/fiscal-xml/fiscal-xml.types';

export interface XsdValidatorPort {
  validate(generatedXml: FiscalXmlGenerationResult): FiscalXmlValidationResult;
}

export const XSD_VALIDATOR = Symbol('XsdValidatorPort');
