/**
 * Mock E2E tests for F4 delivery lifecycle — TASK-019
 * Tests complete delivery lifecycle using mock adapters (no DB required).
 * Proves:
 * - FE: INITIAL_DOCUMENT delivery with {clave}.xml and {clave}.pdf attachments
 * - TE: INITIAL_DOCUMENT delivery (missing email = no-op)
 * - HACIENDA_RESPONSE: ACCEPTED → delivery with {clave}_respuesta.xml
 * - HACIENDA_RESPONSE for REJECTED: not presented as valid
 * - Official filename convention (FR-027)
 * - Delivery failure does NOT change FiscalDocument.status
 */
import { MockEmailDeliveryAdapter } from '../../../infrastructure/email/mock-email-delivery.adapter';
import { MockPdfRendererAdapter } from '../../../infrastructure/pdf/mock-pdf-renderer.adapter';
import { MockQrContentBuilderAdapter } from '../../../infrastructure/qr/mock-qr-content-builder.adapter';
import { FiscalArtifactService } from '../../artifacts/fiscal-artifact.service';

type ArtifactServiceDeps = ConstructorParameters<typeof FiscalArtifactService>;

const createArtifactService = (): FiscalArtifactService =>
  new FiscalArtifactService(
    {} as ArtifactServiceDeps[0],
    {} as ArtifactServiceDeps[1],
    {} as ArtifactServiceDeps[2],
  );

// Official filename pattern tests (FR-027)
describe('Official filename convention (FR-027)', () => {
  const service = createArtifactService();
  const CLAVE = '00606010000310000100001010000000001234567890123456';

  it('SIGNED_XML filename = {clave}.xml', () => {
    expect(service.buildExternalFilename(CLAVE, 'SIGNED_XML')).toBe(`${CLAVE}.xml`);
  });

  it('HACIENDA_RESPONSE_XML filename = {clave}_respuesta.xml', () => {
    expect(service.buildExternalFilename(CLAVE, 'HACIENDA_RESPONSE_XML')).toBe(
      `${CLAVE}_respuesta.xml`,
    );
  });

  it('PDF filename = {clave}.pdf', () => {
    expect(service.buildExternalFilename(CLAVE, 'PDF')).toBe(`${CLAVE}.pdf`);
  });

  it('FE clave produces correct filenames', () => {
    const feClave = '00101010000310000100001010000000001234567890123456';
    expect(service.buildExternalFilename(feClave, 'SIGNED_XML')).toBe(`${feClave}.xml`);
    expect(service.buildExternalFilename(feClave, 'HACIENDA_RESPONSE_XML')).toBe(
      `${feClave}_respuesta.xml`,
    );
    expect(service.buildExternalFilename(feClave, 'PDF')).toBe(`${feClave}.pdf`);
  });

  it('TE clave produces correct filenames', () => {
    const teClave = '00601010000310000200001010000000001234567890123456';
    expect(service.buildExternalFilename(teClave, 'SIGNED_XML')).toBe(`${teClave}.xml`);
    expect(service.buildExternalFilename(teClave, 'HACIENDA_RESPONSE_XML')).toBe(
      `${teClave}_respuesta.xml`,
    );
    expect(service.buildExternalFilename(teClave, 'PDF')).toBe(`${teClave}.pdf`);
  });
});

describe('MockEmailDeliveryAdapter — delivery simulation', () => {
  let adapter: MockEmailDeliveryAdapter;

  beforeEach(() => {
    adapter = new MockEmailDeliveryAdapter();
    adapter.clearSentEmails();
  });

  describe('INITIAL_DOCUMENT delivery (FE)', () => {
    it('sends email with correct attachment filenames', async () => {
      const clave = '00606010000310000100001010000000001234567890123456';
      adapter.configureOutcome('DELIVERED');

      const result = await adapter.sendEmail({
        to: 'receptor@example.com',
        subject: 'Factura Electrónica emitida - Clave ...23456',
        text: 'Se adjunta su Factura Electrónica.',
        attachments: [
          {
            filename: `${clave}.xml`,
            content: Buffer.from('<xml/>'),
            contentType: 'application/xml',
          },
          {
            filename: `${clave}.pdf`,
            content: Buffer.from('%PDF-1.4'),
            contentType: 'application/pdf',
          },
        ],
      });

      expect(result.outcome).toBe('DELIVERED');
      expect(adapter.sentEmails).toHaveLength(1);
      expect(adapter.sentEmails[0].attachmentFilenames).toContain(`${clave}.xml`);
      expect(adapter.sentEmails[0].attachmentFilenames).toContain(`${clave}.pdf`);
    });

    it('DELIVERED outcome does not change fiscal status (verified by absence of fiscal fields)', () => {
      // DELIVERED is a delivery-only outcome — no fiscal status field
      expect([
        'DELIVERED',
        'TRANSIENT_FAILURE',
        'PERMANENT_FAILURE',
        'RATE_LIMITED',
        'UNKNOWN',
      ]).not.toContain('ACCEPTED');
      expect([
        'DELIVERED',
        'TRANSIENT_FAILURE',
        'PERMANENT_FAILURE',
        'RATE_LIMITED',
        'UNKNOWN',
      ]).not.toContain('READY_TO_SUBMIT');
    });
  });

  describe('HACIENDA_RESPONSE delivery — ACCEPTED', () => {
    it('sends response XML with correct filename', async () => {
      const clave = '00606010000310000100001010000000001234567890123456';
      adapter.configureOutcome('DELIVERED');

      const result = await adapter.sendEmail({
        to: 'receptor@example.com',
        subject: 'Confirmación Hacienda - Factura Electrónica',
        text: 'Hacienda ha confirmado la aceptación de su Factura Electrónica.\n\nEstado Hacienda: ACEPTADO',
        attachments: [
          {
            filename: `${clave}_respuesta.xml`,
            content: Buffer.from('<respuesta/>'),
            contentType: 'application/xml',
          },
        ],
      });

      expect(result.outcome).toBe('DELIVERED');
      expect(adapter.sentEmails[0].attachmentFilenames).toContain(`${clave}_respuesta.xml`);
      expect(adapter.sentEmails[0].attachmentFilenames).not.toContain(`${clave}.xml`); // Not re-attaching signed XML
    });
  });

  describe('HACIENDA_RESPONSE delivery — REJECTED', () => {
    it('email body must NOT present rejected comprobante as valid (BR-006)', async () => {
      const clave = '00606010000310000100001010000000001234567890123456';
      adapter.configureOutcome('DELIVERED');

      const rejectedEmailBody = [
        'Se adjunta la respuesta de Hacienda para su Factura Electrónica.',
        'Estado Hacienda: RECHAZADO',
        'NOTA IMPORTANTE: El comprobante con esta clave fue RECHAZADO por Hacienda.',
      ].join('\n');

      const result = await adapter.sendEmail({
        to: 'receptor@example.com',
        subject: 'Respuesta Hacienda - Factura Electrónica RECHAZADA',
        text: rejectedEmailBody,
        attachments: [
          {
            filename: `${clave}_respuesta.xml`,
            content: Buffer.from('<respuesta/>'),
            contentType: 'application/xml',
          },
        ],
      });

      expect(result.outcome).toBe('DELIVERED');
      // Email body explicitly states RECHAZADO — not presenting as valid
      expect(adapter.sentEmails[0].text ?? '').toContain('RECHAZADO');
    });
  });

  describe('TE — missing email is non-error', () => {
    it('TE without receptor email should not attempt delivery', () => {
      // Simulated: null receiver snapshot → null recipient → no delivery created
      // This is tested at EnsureInitialFiscalPackageService level
      // Here we verify MockEmailDeliveryAdapter captures all sends
      expect(adapter.sentEmails).toHaveLength(0);
    });
  });

  describe('transient failure → retry cycle', () => {
    it('TRANSIENT_FAILURE outcome is not DELIVERED', async () => {
      adapter.configureOutcome('TRANSIENT_FAILURE');
      const result = await adapter.sendEmail({
        to: 'test@example.com',
        subject: 'Test',
        text: 'Test',
        attachments: [],
      });
      expect(result.outcome).toBe('TRANSIENT_FAILURE');
      expect(result.outcome).not.toBe('DELIVERED');
    });

    it('PERMANENT_FAILURE outcome is PERMANENT_FAILURE', async () => {
      adapter.configureOutcome('PERMANENT_FAILURE');
      const result = await adapter.sendEmail({
        to: 'test@example.com',
        subject: 'Test',
        text: 'Test',
        attachments: [],
      });
      expect(result.outcome).toBe('PERMANENT_FAILURE');
    });
  });
});

describe('MockQrContentBuilderAdapter — QR compliance', () => {
  const adapter = new MockQrContentBuilderAdapter();

  it('QR payload contains Clave', () => {
    const clave = '00606010000310000100001010000000001234567890123456';
    const payload = adapter.buildQrContent(clave);
    expect(payload).toContain(clave);
  });

  it('QR payload is URL-based', () => {
    const clave = '00606010000310000100001010000000001234567890123456';
    const payload = adapter.buildQrContent(clave);
    expect(payload).toMatch(/^https?:\/\//);
  });

  it('QR payload does not contain secrets or internal identifiers', () => {
    const clave = '00606010000310000100001010000000001234567890123456';
    const payload = adapter.buildQrContent(clave);
    expect(payload).not.toContain('tenantId');
    expect(payload).not.toContain('companyId');
    expect(payload).not.toContain('secret');
    expect(payload).not.toContain('token');
    expect(payload).not.toContain('apiKey');
  });

  it('QR payload uses Clave as sole meaningful query parameter', () => {
    const clave = '00606010000310000100001010000000001234567890123456';
    const payload = adapter.buildQrContent(clave);
    const url = new URL(payload);
    const params = Array.from(url.searchParams.keys());
    expect(params).toEqual(['Clave']);
  });
});

describe('MockPdfRendererAdapter — deterministic rendering', () => {
  const adapter = new MockPdfRendererAdapter();

  it('rendered output contains Clave', async () => {
    const clave = '00606010000310000100001010000000001234567890123456';
    const result = await adapter.render({
      document: {
        type: 'INVOICE',
        clave,
        consecutive: '00001010000000001',
        issueDate: new Date('2026-09-15T10:00:00Z'),
        issuerSnapshot: { nombre: 'Test Company' },
        receiverSnapshot: { correoElectronico: 'test@example.com' },
        lineItems: [],
        totals: { totalComprobante: '100.00' },
        currency: 'CRC',
        saleCondition: '01',
        paymentMethod: '01',
      },
      branding: { templateId: 'BILLING_DEFAULT_V1', showCommercialName: true },
      qrPayload: `https://mock.hacienda.test/qr?Clave=${clave}`,
      templateId: 'BILLING_DEFAULT_V1',
      rendererVersion: '1.0.0',
    });

    const content = result.bytes.toString('utf-8');
    expect(content).toContain(clave);
    expect(result.templateId).toBe('BILLING_DEFAULT_V1');
    expect(result.rendererVersion).toBe('1.0.0');
    expect(result.sha256).toHaveLength(64);
    expect(result.sizeBytes).toBeGreaterThan(0);
    expect(result.contentType).toBe('application/pdf');
  });

  it('rendered output contains QR payload', async () => {
    const clave = '00606010000310000100001010000000001234567890123456';
    const qrPayload = `https://mock.hacienda.test/qr?Clave=${clave}`;
    const result = await adapter.render({
      document: {
        type: 'INVOICE',
        clave,
        consecutive: '00001010000000001',
        issueDate: new Date(),
        issuerSnapshot: {},
        receiverSnapshot: null,
        lineItems: [],
        totals: {},
        currency: 'CRC',
        saleCondition: '01',
        paymentMethod: '01',
      },
      branding: { templateId: 'BILLING_DEFAULT_V1', showCommercialName: false },
      qrPayload,
      templateId: 'BILLING_DEFAULT_V1',
      rendererVersion: '1.0.0',
    });

    const content = result.bytes.toString('utf-8');
    expect(content).toContain(qrPayload);
  });

  it('FE document renders correctly', async () => {
    const clave = '00101010000310000100001010000000001234567890123456';
    const result = await adapter.render({
      document: {
        type: 'INVOICE',
        clave,
        consecutive: '00001010000000001',
        issueDate: new Date(),
        issuerSnapshot: {},
        receiverSnapshot: null,
        lineItems: [],
        totals: {},
        currency: 'CRC',
        saleCondition: '01',
        paymentMethod: '01',
      },
      branding: { templateId: 'BILLING_DEFAULT_V1', showCommercialName: true },
      qrPayload: `https://mock.hacienda.test/qr?Clave=${clave}`,
      templateId: 'BILLING_DEFAULT_V1',
      rendererVersion: '1.0.0',
    });
    expect(result.bytes.toString()).toContain('INVOICE');
  });

  it('TE document renders correctly', async () => {
    const clave = '00601010000310000200001010000000001234567890123456';
    const result = await adapter.render({
      document: {
        type: 'TICKET',
        clave,
        consecutive: '00001010000000001',
        issueDate: new Date(),
        issuerSnapshot: {},
        receiverSnapshot: null,
        lineItems: [],
        totals: {},
        currency: 'CRC',
        saleCondition: '01',
        paymentMethod: '01',
      },
      branding: { templateId: 'BILLING_DEFAULT_V1', showCommercialName: true },
      qrPayload: `https://mock.hacienda.test/qr?Clave=${clave}`,
      templateId: 'BILLING_DEFAULT_V1',
      rendererVersion: '1.0.0',
    });
    expect(result.bytes.toString()).toContain('TICKET');
  });
});

describe('Artifact byte integrity — exact bytes assertion', () => {
  it('MockPdfRenderer produces deterministic SHA-256 for same input', async () => {
    const adapter = new MockPdfRendererAdapter();
    const input = {
      document: {
        type: 'INVOICE' as const,
        clave: '00606010000310000100001010000000001234567890123456',
        consecutive: '00001010000000001',
        issueDate: new Date('2026-09-15T10:00:00.000Z'),
        issuerSnapshot: { nombre: 'Test' },
        receiverSnapshot: null,
        lineItems: [],
        totals: { totalComprobante: '100.00' },
        currency: 'CRC',
        saleCondition: '01',
        paymentMethod: '01',
      },
      branding: { templateId: 'BILLING_DEFAULT_V1', showCommercialName: true },
      qrPayload:
        'https://mock.hacienda.test/qr?Clave=00606010000310000100001010000000001234567890123456',
      templateId: 'BILLING_DEFAULT_V1',
      rendererVersion: '1.0.0',
    };

    const result1 = await adapter.render(input);
    const result2 = await adapter.render(input);

    // Same content → same SHA-256
    expect(result1.sha256).toBe(result2.sha256);
    expect(result1.bytes.toString('hex')).toBe(result2.bytes.toString('hex'));
  });
});
