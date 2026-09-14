import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { QueueModule } from '../../infrastructure/queue/queue.module';
import { AuditModule } from '../audit/audit.module';
import { IdentityModule } from '../identity/identity.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { HaciendaConnectionModule } from '../hacienda-connection/hacienda-connection.module';
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
import { FiscalSubmissionController } from './infrastructure/http/fiscal-submission.controller';
import { SubmitFiscalDocumentService } from './application/submission/submit-fiscal-document.service';
import { HACIENDA_SUBMISSION_PORT } from './application/submission/ports/hacienda-submission.port';
import { HaciendaRecepcionAdapter } from './infrastructure/submission/hacienda-recepcion.adapter';
import { MockHaciendaSubmissionAdapter } from './infrastructure/submission/mock-hacienda-submission.adapter';
import { HaciendaCallbackController } from './infrastructure/http/hacienda-callback.controller';
import { GetFiscalSubmissionStatusService } from './application/submission/get-fiscal-submission-status.service';
import { RequestFiscalSubmissionReconciliationService } from './application/submission/request-fiscal-submission-reconciliation.service';
import { HandleHaciendaCallbackService } from './application/submission/handle-hacienda-callback.service';
import { FiscalSubmissionStateService } from './application/submission/fiscal-submission-state.service';
import { FiscalSubmissionWorkerService } from './application/submission/workers/fiscal-submission-worker.service';

@Module({
  imports: [
    DatabaseModule,
    AuditModule,
    IdentityModule,
    ApiKeysModule,
    HaciendaConnectionModule,
    QueueModule,
    HttpModule,
  ],
  controllers: [
    FiscalManagementController,
    FiscalDocumentsController,
    FiscalPublicDocumentsController,
    FiscalXmlController,
    FiscalSubmissionController,
    HaciendaCallbackController,
  ],
  providers: [
    FiscalDocumentService,
    PrepareFiscalXmlService,
    FiscalSigningCertificateService,
    SubmitFiscalDocumentService,
    GetFiscalSubmissionStatusService,
    RequestFiscalSubmissionReconciliationService,
    HandleHaciendaCallbackService,
    FiscalSubmissionStateService,
    FiscalSubmissionWorkerService,
    HaciendaV44XmlSerializerAdapter,
    HaciendaRecepcionAdapter,
    MockHaciendaSubmissionAdapter,
    { provide: Xsd11ValidatorAdapter, useFactory: () => new Xsd11ValidatorAdapter() },
    { provide: FISCAL_XML_SERIALIZER, useExisting: HaciendaV44XmlSerializerAdapter },
    { provide: XSD_VALIDATOR, useExisting: Xsd11ValidatorAdapter },
    {
      provide: HACIENDA_SUBMISSION_PORT,
      useFactory: (
        configService: ConfigService,
        realAdapter: HaciendaRecepcionAdapter,
        mockAdapter: MockHaciendaSubmissionAdapter,
      ) => (configService.get<boolean>('hacienda.useReal') ? realAdapter : mockAdapter),
      inject: [ConfigService, HaciendaRecepcionAdapter, MockHaciendaSubmissionAdapter],
    },
  ],
})
export class FiscalDocumentsModule {}
