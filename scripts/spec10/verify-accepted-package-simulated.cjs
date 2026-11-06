'use strict';

// Run with: Get-Content -Raw this-file | docker exec -i billing-container node -
// Uses Billing's installed PDF renderer and verified evidence resolver. No SMTP.
const { createHash } = require('node:crypto');
const { NestFactory } = require('/app/node_modules/@nestjs/core');
const { AppModule } = require('/app/dist/src/app.module');
const { PrismaService } = require('/app/dist/src/infrastructure/database/prisma.service');
const { GenerateFiscalPdfService } = require('/app/dist/src/modules/fiscal-documents/application/artifacts/generate-fiscal-pdf.service');
const { AcceptedFiscalPackageResendService } = require('/app/dist/src/modules/fiscal-documents/application/delivery/accepted-fiscal-package-resend.service');
const { MockEmailDeliveryAdapter } = require('/app/dist/src/modules/fiscal-documents/infrastructure/email/mock-email-delivery.adapter');

const documentId = '817f1bd8-0092-4661-9064-e7f69d18b5b6';
const expectedClave = '50606112600020753025100100001010000000008156925025';
const expectedRecipient = 'kmena281@gmail.com';

async function main() {
  if (process.env.NODE_ENV !== 'test' || process.env.EMAIL_USE_REAL !== 'false' ||
      process.env.USE_REAL_HACIENDA !== 'false' || process.env.BILLING_SPEC09_STAG_INVOICING !== 'false') {
    throw new Error('SPEC10_PACKAGE_FLAGS_UNSAFE');
  }
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const prisma = app.get(PrismaService);
    const document = await prisma.fiscalDocument.findUnique({
      where: { id: documentId },
      select: {
        id: true, tenantId: true, companyId: true, environment: true,
        type: true, status: true, clave: true, consecutive: true,
        submission: { select: { status: true, attemptCount: true, reconciliationAttemptCount: true, responseSha256: true } },
      },
    });
    if (!document || document.environment !== 'SANDBOX' || document.type !== 'INVOICE' ||
        document.status !== 'ACCEPTED' || document.clave !== expectedClave ||
        document.consecutive !== '00100001010000000008' ||
        document.submission?.status !== 'ACCEPTED' || document.submission.attemptCount !== 1 ||
        document.submission.reconciliationAttemptCount !== 1 || !document.submission.responseSha256) {
      throw new Error('SPEC10_PACKAGE_DOCUMENT_GUARD_FAILED');
    }
    await app.get(GenerateFiscalPdfService).generateOrReuse(document.tenantId, document.companyId, document.id);
    const preflight = await app.get(AcceptedFiscalPackageResendService).preflightForAuthorizedRequest({
      tenantId: document.tenantId,
      companyId: document.companyId,
      environment: 'SANDBOX',
      fiscalDocumentId: document.id,
    });
    if (preflight.recipient !== expectedRecipient || preflight.clave !== expectedClave ||
        preflight.attachments.length !== 3 ||
        !preflight.attachments.some((x) => x.filename === `${expectedClave}.pdf`) ||
        !preflight.attachments.some((x) => x.filename === `${expectedClave}.xml`) ||
        !preflight.attachments.some((x) => x.filename === `${expectedClave}_respuesta.xml`)) {
      throw new Error('SPEC10_PACKAGE_PREFLIGHT_FAILED');
    }
    for (const attachment of preflight.attachments) {
      if (!Buffer.isBuffer(attachment.content) || attachment.content.length < 100) {
        throw new Error('SPEC10_PACKAGE_ATTACHMENT_INVALID');
      }
    }
    const mock = app.get(MockEmailDeliveryAdapter);
    mock.clearSentEmails();
    const outcome = await mock.sendEmail({
      to: preflight.recipient,
      subject: 'Comprobante electrónico de prueba STAG',
      text: 'Entrega simulada de la factura aceptada en Hacienda STAG.',
      attachments: preflight.attachments,
    });
    if (outcome.outcome !== 'DELIVERED' || mock.sentEmails.length !== 1 ||
        mock.sentEmails[0].attachmentFilenames.length !== 3) {
      throw new Error('SPEC10_PACKAGE_MOCK_DELIVERY_FAILED');
    }
    const pdf = preflight.attachments.find((x) => x.filename.endsWith('.pdf'));
    const pdfSha256 = createHash('sha256').update(pdf.content).digest('hex');
    console.log(`SPEC10_ACCEPTED_PACKAGE_SIMULATED_PASS pdf_sha256=${pdfSha256} attachments=3 smtp=false`);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  const code = typeof error?.message === 'string' && /^SPEC10_[A-Z_]+$/.test(error.message)
    ? error.message : 'SPEC10_PACKAGE_UNEXPECTED_FAILURE';
  console.error(code);
  process.exitCode = 1;
});
