import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { AuditModule } from '../audit/audit.module';
import { IdentityModule } from '../identity/identity.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { FiscalDocumentService } from './application/fiscal-document.service';
import { PrepareFiscalXmlService } from './application/fiscal-xml/prepare-fiscal-xml.service';
import { FiscalSigningCertificateService } from './application/fiscal-xml/fiscal-signing-certificate.service';
import { FISCAL_XML_SERIALIZER } from './application/fiscal-xml/fiscal-xml-serializer.port';
import { XSD_VALIDATOR } from './application/fiscal-xml/xsd-validator.port';
import { HaciendaV44XmlSerializerAdapter } from './infrastructure/xml/hacienda-v44-xml-serializer.adapter';
import { Xsd11ValidatorAdapter } from './infrastructure/xml/xsd11-validator.adapter';
import { FiscalManagementController } from './infrastructure/http/fiscal-management.controller';
import { FiscalPublicDocumentsController } from './infrastructure/http/fiscal-public-documents.controller';
import { FiscalDocumentsController } from './infrastructure/http/fiscal-documents.controller';
import { FiscalXmlController } from './infrastructure/http/fiscal-xml.controller';

@Module({
  imports: [DatabaseModule, AuditModule, IdentityModule, ApiKeysModule],
  controllers: [
    FiscalManagementController,
    FiscalDocumentsController,
    FiscalPublicDocumentsController,
    FiscalXmlController,
  ],
  providers: [
    FiscalDocumentService,
    PrepareFiscalXmlService,
    FiscalSigningCertificateService,
    HaciendaV44XmlSerializerAdapter,
    { provide: Xsd11ValidatorAdapter, useFactory: () => new Xsd11ValidatorAdapter() },
    { provide: FISCAL_XML_SERIALIZER, useExisting: HaciendaV44XmlSerializerAdapter },
    { provide: XSD_VALIDATOR, useExisting: Xsd11ValidatorAdapter },
  ],
})
export class FiscalDocumentsModule {}
