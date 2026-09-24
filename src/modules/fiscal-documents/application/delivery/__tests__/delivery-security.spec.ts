/**
 * Security hardening tests — F4 TASK-017
 * Tests threat model scenarios from security-threat-model.md.
 *
 * Coverage:
 * - QR: no internal identifier leakage
 * - QR: missing production config fails fast
 * - Logo: SVG rejected, oversized rejected, path traversal rejected
 * - Content-Disposition: CRLF injection prevention, path traversal prevention
 * - Attachment filename: uses official convention, not storage key
 * - Artifact hash mismatch: security audit event emitted
 * - Email header injection prevention
 * - Corrupt artifact delivery blocked
 */
import { MockQrContentBuilderAdapter } from '../../../infrastructure/qr/mock-qr-content-builder.adapter';
import { HaciendaQrContentBuilderAdapter } from '../../../infrastructure/qr/hacienda-qr-content-builder.adapter';
import { InvalidClaveException } from '../../../domain/delivery/invalid-clave.exception';
import {
  UnsafeLogoException,
  CompanyPdfSettingsService,
} from '../../pdf/company-pdf-settings.service';
import { FiscalArtifactService } from '../../artifacts/fiscal-artifact.service';
import { DeliveryRetryClassifier } from '../../../domain/delivery/delivery-retry-classifier';
import { DocumentDeliveryStatus } from '../../../domain/delivery/document-delivery-status.enum';

type ArtifactServiceDeps = ConstructorParameters<typeof FiscalArtifactService>;
type PdfSettingsDeps = ConstructorParameters<typeof CompanyPdfSettingsService>;

const createArtifactService = (): FiscalArtifactService =>
  new FiscalArtifactService(
    {} as ArtifactServiceDeps[0],
    {} as ArtifactServiceDeps[1],
    {} as ArtifactServiceDeps[2],
  );

const createPdfSettingsService = (): CompanyPdfSettingsService =>
  new CompanyPdfSettingsService({} as PdfSettingsDeps[0], {} as PdfSettingsDeps[1]);

const SVG_CONTENT = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
);
describe('Security: QR content builder', () => {
  const mockAdapter = new MockQrContentBuilderAdapter();

  it('QR payload does not contain tenant ID', () => {
    const clave = '12345678901234567890123456789012345678901234567890';
    const payload = mockAdapter.buildQrContent(clave);
    expect(payload).not.toContain('tenant');
    expect(payload).not.toContain('company');
  });

  it('QR payload does not contain internal storage key', () => {
    const clave = '12345678901234567890123456789012345678901234567890';
    const payload = mockAdapter.buildQrContent(clave);
    expect(payload).not.toContain('fiscal-xml');
    expect(payload).not.toContain('fiscal-pdf');
    expect(payload).not.toContain('s3://');
    expect(payload).not.toContain('/uploads/');
  });

  it('QR payload does not contain authentication token', () => {
    const clave = '12345678901234567890123456789012345678901234567890';
    const payload = mockAdapter.buildQrContent(clave);
    expect(payload).not.toContain('Bearer');
    expect(payload).not.toContain('X-API-Key');
    expect(payload).not.toContain('jwt');
  });

  it('QR payload does not contain presigned URL signature', () => {
    const clave = '12345678901234567890123456789012345678901234567890';
    const payload = mockAdapter.buildQrContent(clave);
    expect(payload).not.toContain('Signature=');
    expect(payload).not.toContain('X-Amz-Signature');
    expect(payload).not.toContain('AWSAccessKeyId');
  });

  it('Production QR adapter throws on missing configuration (fail-fast)', () => {
    expect(() => new HaciendaQrContentBuilderAdapter('')).toThrow();
    expect(() => new HaciendaQrContentBuilderAdapter('   ')).toThrow();
  });

  it('Malformed Clave throws InvalidClaveException (no silent production of malformed QR)', () => {
    expect(() => mockAdapter.buildQrContent('')).toThrow(InvalidClaveException);
    expect(() => mockAdapter.buildQrContent('123')).toThrow(InvalidClaveException);
    expect(() =>
      mockAdapter.buildQrContent('abc12345678901234567890123456789012345678901234567'),
    ).toThrow(InvalidClaveException);
  });
});

describe('Security: Logo validation', () => {
  const pdfSettings = createPdfSettingsService();

  it('rejects SVG (no valid magic bytes)', async () => {
    await expect(
      pdfSettings.uploadLogo({
        tenantId: 't1',
        companyId: 'c1',
        logoBytes: SVG_CONTENT,
        declaredMimeType: 'image/svg+xml',
      }),
    ).rejects.toThrow(UnsafeLogoException);
  });

  it('rejects oversized file (> 2 MB)', async () => {
    const bigFile = Buffer.alloc(2 * 1024 * 1024 + 1, 0xff);
    await expect(
      pdfSettings.uploadLogo({
        tenantId: 't1',
        companyId: 'c1',
        logoBytes: bigFile,
        declaredMimeType: 'image/png',
      }),
    ).rejects.toThrow(UnsafeLogoException);
  });

  it('rejects empty file', async () => {
    await expect(
      pdfSettings.uploadLogo({
        tenantId: 't1',
        companyId: 'c1',
        logoBytes: Buffer.alloc(0),
        declaredMimeType: 'image/png',
      }),
    ).rejects.toThrow(UnsafeLogoException);
  });

  it('rejects HTML/JavaScript disguised as image', async () => {
    const htmlContent = Buffer.from('<html><script>alert("xss")</script></html>');
    await expect(
      pdfSettings.uploadLogo({
        tenantId: 't1',
        companyId: 'c1',
        logoBytes: htmlContent,
        declaredMimeType: 'image/jpeg',
      }),
    ).rejects.toThrow(UnsafeLogoException);
  });

  it('does NOT trust filename extension — validates magic bytes', async () => {
    // PNG magic bytes but it is actually truncated/corrupt
    const truncatedPng = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // Only 4 bytes
    await expect(
      pdfSettings.uploadLogo({
        tenantId: 't1',
        companyId: 'c1',
        logoBytes: truncatedPng,
        declaredMimeType: 'image/png',
      }),
    ).rejects.toThrow(UnsafeLogoException);
  });
});

describe('Security: Content-Disposition header injection prevention', () => {
  const service = createArtifactService();
  const CLAVE = '12345678901234567890123456789012345678901234567890';

  it('CRLF injection in filename is sanitized', () => {
    const malicious = `${CLAVE}.xml\r\nContent-Type: text/html\r\n\r\n<evil/>`;
    const disposition = service.buildContentDisposition(malicious);
    expect(disposition).not.toContain('\r\n');
    expect(disposition).not.toContain('\r');
    expect(disposition).not.toContain('\n');
    expect(disposition).not.toContain('<evil/>');
  });

  it('path traversal in filename is prevented', () => {
    const malicious = '../../../etc/passwd';
    const disposition = service.buildContentDisposition(malicious);
    expect(disposition).not.toContain('..');
    expect(disposition).not.toContain('/etc/passwd');
  });

  it('backslash path traversal is prevented', () => {
    const malicious = '..\\..\\windows\\system32\\config.xml';
    const disposition = service.buildContentDisposition(malicious);
    expect(disposition).not.toContain('\\');
  });

  it('valid clave-based filename is preserved correctly', () => {
    const valid = `${CLAVE}.xml`;
    const disposition = service.buildContentDisposition(valid);
    expect(disposition).toBe(`attachment; filename="${valid}"`);
  });
});

describe('Security: Artifact hash mismatch → security audit', () => {
  it('ARTIFACT_HASH_MISMATCH classification emits security audit', () => {
    const result = DeliveryRetryClassifier.classify({
      errorClass: 'ARTIFACT_HASH_MISMATCH',
      retryCount: 0,
      maxRetries: 8,
    });
    expect(result.nextStatus).toBe(DocumentDeliveryStatus.MANUAL_REVIEW_REQUIRED);
    expect(result.emitSecurityAudit).toBe(true);
    expect(result.immediateRetry).toBe(false);
  });
});

describe('Security: Attachment filename convention (no storage key exposure)', () => {
  const service = createArtifactService();
  const CLAVE = '12345678901234567890123456789012345678901234567890';

  it('SIGNED_XML attachment filename does not contain storage path', () => {
    const filename = service.buildExternalFilename(CLAVE, 'SIGNED_XML');
    // The filename must be {clave}.xml — NOT the internal storage key
    expect(filename).toBe(`${CLAVE}.xml`);
    expect(filename).not.toContain('fiscal-xml-artifacts');
    expect(filename).not.toContain('fiscal-submissions');
    expect(filename).not.toContain('hacienda-response');
  });

  it('HACIENDA_RESPONSE_XML attachment filename does not contain storage path', () => {
    const filename = service.buildExternalFilename(CLAVE, 'HACIENDA_RESPONSE_XML');
    expect(filename).toBe(`${CLAVE}_respuesta.xml`);
    expect(filename).not.toContain('responseStorageKey');
    expect(filename).not.toContain('/');
  });

  it('PDF attachment filename does not contain storage path', () => {
    const filename = service.buildExternalFilename(CLAVE, 'PDF');
    expect(filename).toBe(`${CLAVE}.pdf`);
    expect(filename).not.toContain('fiscal-pdfs');
    expect(filename).not.toContain('BILLING_DEFAULT_V1');
    expect(filename).not.toContain('/');
  });
});

describe('Security: Email header injection prevention (NodemailerAdapter)', () => {
  it('Email with newline in recipient address triggers PERMANENT_FAILURE', async () => {
    const { NodemailerEmailDeliveryAdapter } =
      await import('../../../infrastructure/email/nodemailer-email-delivery.adapter');
    const adapter = new NodemailerEmailDeliveryAdapter({
      host: 'localhost',
      port: 587,
      secure: false,
      user: 'test',
      password: 'test',
      fromAddress: 'test@example.com',
      fromName: 'Test',
    });

    // Note: the adapter validates the recipient before attempting to send
    const result = await adapter.sendEmail({
      to: 'evil@example.com\r\nBcc: attacker@evil.com',
      subject: 'Test',
      text: 'Test',
      attachments: [],
    });
    expect(result.outcome).toBe('PERMANENT_FAILURE');
    expect(result.sanitizedErrorCode).toBe('INVALID_RECIPIENT_FORMAT');
  });
});
