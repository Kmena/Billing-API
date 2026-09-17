import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
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
import { FiscalArtifactsController } from './infrastructure/http/fiscal-artifacts.controller';
import { FiscalDeliveriesController } from './infrastructure/http/fiscal-deliveries.controller';
import { CompanyPdfSettingsController } from './infrastructure/http/company-pdf-settings.controller';
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
// F4 imports
import { FiscalEvidenceResolverService } from './application/artifacts/fiscal-evidence-resolver.service';
import { FiscalArtifactService } from './application/artifacts/fiscal-artifact.service';
import { GenerateFiscalPdfService } from './application/artifacts/generate-fiscal-pdf.service';
import { CompanyPdfSettingsService } from './application/pdf/company-pdf-settings.service';
import { EnsureInitialFiscalPackageService } from './application/delivery/ensure-initial-fiscal-package.service';
import { EnsureHaciendaResponseDeliveryService } from './application/delivery/ensure-hacienda-response-delivery.service';
import { DeliveryWorkerService } from './application/delivery/delivery-worker.service';
import { DeliveryRequestService } from './application/delivery/delivery-request.service';
import { PDF_RENDERER } from './application/pdf/pdf-renderer.port';
import { QR_CONTENT_BUILDER } from './application/qr/qr-content-builder.port';
import { EMAIL_DELIVERY_PORT } from './application/email/email-delivery.port';
import { BillingDefaultV1PdfRendererAdapter } from './infrastructure/pdf/billing-default-v1-pdf-renderer.adapter';
import { MockPdfRendererAdapter } from './infrastructure/pdf/mock-pdf-renderer.adapter';
import { HaciendaQrContentBuilderAdapter } from './infrastructure/qr/hacienda-qr-content-builder.adapter';
import { MockQrContentBuilderAdapter } from './infrastructure/qr/mock-qr-content-builder.adapter';
import { MockEmailDeliveryAdapter } from './infrastructure/email/mock-email-delivery.adapter';
import { NodemailerEmailDeliveryAdapter } from './infrastructure/email/nodemailer-email-delivery.adapter';

@Module({
  imports: [
    DatabaseModule,
    AuditModule,
    IdentityModule,
    ApiKeysModule,
    HaciendaConnectionModule,
    QueueModule,
    HttpModule,
    MulterModule.register({ dest: '/tmp/uploads' }),
  ],
  controllers: [
    FiscalManagementController,
    FiscalDocumentsController,
    FiscalPublicDocumentsController,
    FiscalXmlController,
    FiscalSubmissionController,
    HaciendaCallbackController,
    // F4 controllers
    FiscalArtifactsController,
    FiscalDeliveriesController,
    CompanyPdfSettingsController,
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
    // F4: PDF renderer
    BillingDefaultV1PdfRendererAdapter,
    MockPdfRendererAdapter,
    {
      provide: PDF_RENDERER,
      useFactory: (
        configService: ConfigService,
        real: BillingDefaultV1PdfRendererAdapter,
        mock: MockPdfRendererAdapter,
      ) => (configService.get<string>('NODE_ENV') === 'production' ? real : mock),
      inject: [ConfigService, BillingDefaultV1PdfRendererAdapter, MockPdfRendererAdapter],
    },
    // F4: QR content builder
    MockQrContentBuilderAdapter,
    {
      provide: QR_CONTENT_BUILDER,
      useFactory: (configService: ConfigService, mock: MockQrContentBuilderAdapter) => {
        const qrBase = configService.get<string>('HACIENDA_QR_URL_BASE');
        const useReal = configService.get<string>('NODE_ENV') === 'production';
        if (useReal && qrBase) {
          return new HaciendaQrContentBuilderAdapter(qrBase);
        }
        return mock;
      },
      inject: [ConfigService, MockQrContentBuilderAdapter],
    },
    // F4: Email delivery
    MockEmailDeliveryAdapter,
    {
      provide: EMAIL_DELIVERY_PORT,
      useFactory: (configService: ConfigService, mock: MockEmailDeliveryAdapter) => {
        const useReal = configService.get<boolean>('EMAIL_USE_REAL');
        if (useReal) {
          const smtpHost = configService.get<string>('SMTP_HOST');
          const smtpUser = configService.get<string>('SMTP_USER');
          const smtpPassword = configService.get<string>('SMTP_PASSWORD');
          const fromAddress = configService.get<string>('EMAIL_FROM_ADDRESS');
          const fromName = configService.get<string>('EMAIL_FROM_NAME') ?? 'Billing Electrónico';
          if (!smtpHost || !smtpUser || !smtpPassword || !fromAddress) {
            throw new Error(
              'EMAIL_USE_REAL=true requires SMTP_HOST, SMTP_USER, SMTP_PASSWORD, EMAIL_FROM_ADDRESS',
            );
          }
          return new NodemailerEmailDeliveryAdapter({
            host: smtpHost,
            port: configService.get<number>('SMTP_PORT') ?? 587,
            secure: configService.get<boolean>('SMTP_SECURE') ?? false,
            user: smtpUser,
            password: smtpPassword,
            fromAddress,
            fromName,
          });
        }
        return mock;
      },
      inject: [ConfigService, MockEmailDeliveryAdapter],
    },
    // F4: Application services
    FiscalEvidenceResolverService,
    FiscalArtifactService,
    GenerateFiscalPdfService,
    CompanyPdfSettingsService,
    EnsureInitialFiscalPackageService,
    EnsureHaciendaResponseDeliveryService,
    DeliveryWorkerService,
    DeliveryRequestService,
  ],
  exports: [
    // Export F4 services needed by workers
    EnsureInitialFiscalPackageService,
    EnsureHaciendaResponseDeliveryService,
    DeliveryWorkerService,
    FiscalEvidenceResolverService,
  ],
})
export class FiscalDocumentsModule {}
