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
import { CrCertificateIdentityExtractorService } from './application/fiscal-xml/cr-certificate-identity-extractor.service';
import { UploadFiscalSigningCertificateService } from './application/fiscal-xml/upload-fiscal-signing-certificate.service';
import { FiscalReadCertificateMetadataService } from './application/fiscal-xml/fiscal-read-certificate-metadata.service';
import { FiscalReadinessService } from './application/fiscal-xml/fiscal-readiness.service';
import { FiscalIssuanceEligibilityService } from './application/fiscal-xml/fiscal-issuance-eligibility.service';
import { FiscalCertificateController } from './infrastructure/http/fiscal-certificate.controller';
import { FISCAL_XML_SERIALIZER } from './application/fiscal-xml/fiscal-xml-serializer.port';
import { XSD_VALIDATOR } from './application/fiscal-xml/xsd-validator.port';
import { HaciendaV44XmlSerializerAdapter } from './infrastructure/xml/hacienda-v44-xml-serializer.adapter';
import { Xsd11ValidatorAdapter } from './infrastructure/xml/xsd11-validator.adapter';
import { FiscalManagementController } from './infrastructure/http/fiscal-management.controller';
import { FiscalPublicDocumentsController } from './infrastructure/http/fiscal-public-documents.controller';
import { FiscalDocumentsController } from './infrastructure/http/fiscal-documents.controller';
import { FiscalIdentityLookupController } from './infrastructure/http/fiscal-identity-lookup.controller';
import { FiscalIdentityLookupService } from './application/fiscal-identity-lookup.service';
import { FiscalIdentityEvidenceLookupController } from './infrastructure/http/fiscal-identity-evidence-lookup.controller';
import { FiscalIdentityEvidenceLookupService } from './application/fiscal-identity-evidence-lookup.service';
import { FiscalXmlController } from './infrastructure/http/fiscal-xml.controller';
import { FiscalSubmissionController } from './infrastructure/http/fiscal-submission.controller';
import { FiscalArtifactsController } from './infrastructure/http/fiscal-artifacts.controller';
import { FiscalDeliveriesController } from './infrastructure/http/fiscal-deliveries.controller';
import { AcceptedFiscalPackageResendController } from './infrastructure/http/accepted-fiscal-package-resend.controller';
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
import { FiscalPdfArtifactStateService } from './application/artifacts/fiscal-pdf-artifact-state.service';
import { FiscalArtifactIndexService } from './application/artifacts/fiscal-artifact-index.service';
import { CompanyPdfSettingsService } from './application/pdf/company-pdf-settings.service';
import { EnsureInitialFiscalPackageService } from './application/delivery/ensure-initial-fiscal-package.service';
import { EnsureHaciendaResponseDeliveryService } from './application/delivery/ensure-hacienda-response-delivery.service';
import { DeliveryWorkerService } from './application/delivery/delivery-worker.service';
import { DurableDeliveryRecoveryService } from './application/delivery/durable-delivery-recovery.service';
import { DeliveryRequestService } from './application/delivery/delivery-request.service';
import { AcceptedFiscalPackageResendService } from './application/delivery/accepted-fiscal-package-resend.service';
import {
  FISCAL_PDF_ATOMIC_RUNTIME_ACTIVATED,
  FISCAL_REPRESENTATION_PDF_RENDERER,
} from './application/pdf/pdf-renderer.port';
import { VALID_PDF_VERIFIER } from './application/pdf/valid-pdf-verifier.port';
import {
  FISCAL_REPRESENTATION_PDF_RENDERER_PROVIDER,
  NORMAL_PDF_RENDERER_PROVIDER,
  assertFiscalPdfBootstrapState,
} from './application/pdf/fiscal-pdf-provider-policy';
import { FiscalRepresentationPdfPipeline } from './application/pdf/fiscal-representation-pdf-pipeline';
import { QR_CONTENT_BUILDER } from './application/qr/qr-content-builder.port';
import { EMAIL_DELIVERY_PORT } from './application/email/email-delivery.port';
import { BillingDefaultV1PdfRendererAdapter } from './infrastructure/pdf/billing-default-v1-pdf-renderer.adapter';
import { MockPdfRendererAdapter } from './infrastructure/pdf/mock-pdf-renderer.adapter';
import { HaciendaQrContentBuilderAdapter } from './infrastructure/qr/hacienda-qr-content-builder.adapter';
import { MockQrContentBuilderAdapter } from './infrastructure/qr/mock-qr-content-builder.adapter';
import { MockEmailDeliveryAdapter } from './infrastructure/email/mock-email-delivery.adapter';
import { NodemailerEmailDeliveryAdapter } from './infrastructure/email/nodemailer-email-delivery.adapter';
import { PdfjsValidPdfVerifierAdapter } from './infrastructure/pdf/pdfjs-valid-pdf-verifier.adapter';

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
    FiscalIdentityLookupController,
    FiscalIdentityEvidenceLookupController,
    FiscalPublicDocumentsController,
    FiscalXmlController,
    FiscalSubmissionController,
    HaciendaCallbackController,
    // F4 controllers
    FiscalArtifactsController,
    FiscalDeliveriesController,
    AcceptedFiscalPackageResendController,
    CompanyPdfSettingsController,
    // F5 certificate management
    FiscalCertificateController,
  ],
  providers: [
    FiscalDocumentService,
    FiscalIdentityLookupService,
    FiscalIdentityEvidenceLookupService,
    PrepareFiscalXmlService,
    FiscalSigningCertificateService,
    // F5: certificate upload and management
    CrCertificateIdentityExtractorService,
    UploadFiscalSigningCertificateService,
    FiscalReadCertificateMetadataService,
    FiscalReadinessService,
    FiscalIssuanceEligibilityService,
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
    NORMAL_PDF_RENDERER_PROVIDER,
    // Wave 7 atomic activation: generation, verification and delivery consume
    // the complete safety floor through this single fail-closed runtime token.
    FISCAL_REPRESENTATION_PDF_RENDERER_PROVIDER,
    PdfjsValidPdfVerifierAdapter,
    { provide: VALID_PDF_VERIFIER, useExisting: PdfjsValidPdfVerifierAdapter },
    { provide: FISCAL_PDF_ATOMIC_RUNTIME_ACTIVATED, useValue: true },
    FiscalRepresentationPdfPipeline,
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
      useFactory: (
        configService: ConfigService,
        mock: MockEmailDeliveryAdapter,
        renderer: BillingDefaultV1PdfRendererAdapter | MockPdfRendererAdapter,
        atomicRuntimeActivated: boolean,
      ) => {
        const useReal = configService.get<boolean>('EMAIL_USE_REAL');
        const rendererKind = renderer instanceof MockPdfRendererAdapter ? 'MOCK_TEST_ONLY' : 'REAL';
        assertFiscalPdfBootstrapState({
          renderer: rendererKind,
          email: useReal ? 'SMTP' : 'CAPTURED',
          verifierActive: atomicRuntimeActivated,
          isolatedTestOverride:
            rendererKind === 'MOCK_TEST_ONLY' && configService.get<string>('NODE_ENV') === 'test',
        });
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
      inject: [
        ConfigService,
        MockEmailDeliveryAdapter,
        FISCAL_REPRESENTATION_PDF_RENDERER,
        FISCAL_PDF_ATOMIC_RUNTIME_ACTIVATED,
      ],
    },
    // F4: Application services
    FiscalEvidenceResolverService,
    FiscalArtifactService,
    FiscalArtifactIndexService,
    FiscalPdfArtifactStateService,
    GenerateFiscalPdfService,
    CompanyPdfSettingsService,
    EnsureInitialFiscalPackageService,
    EnsureHaciendaResponseDeliveryService,
    DeliveryWorkerService,
    DurableDeliveryRecoveryService,
    DeliveryRequestService,
    AcceptedFiscalPackageResendService,
  ],
  exports: [
    // Export F4 services needed by workers
    EnsureInitialFiscalPackageService,
    EnsureHaciendaResponseDeliveryService,
    DeliveryWorkerService,
    FiscalEvidenceResolverService,
    FiscalArtifactIndexService,
    GenerateFiscalPdfService,
    FISCAL_REPRESENTATION_PDF_RENDERER,
    VALID_PDF_VERIFIER,
    FiscalRepresentationPdfPipeline,
    UploadFiscalSigningCertificateService,
    FiscalReadCertificateMetadataService,
    FiscalReadinessService,
    FiscalDocumentService,
    PrepareFiscalXmlService,
    SubmitFiscalDocumentService,
    FiscalArtifactService,
    DeliveryRequestService,
  ],
})
export class FiscalDocumentsModule {}
