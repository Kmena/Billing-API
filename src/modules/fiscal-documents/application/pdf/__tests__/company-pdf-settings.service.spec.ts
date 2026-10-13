/**
 * CompanyPdfSettingsService unit tests — F4 TASK-006
 * Tests: logo security (MIME magic-byte validation), branding isolation from fiscal content.
 */
import { CompanyPdfSettingsService } from '../company-pdf-settings.service';
import { UnsafeLogoException } from '../company-pdf-settings.service';
import { createCanvas } from '@napi-rs/canvas';

type PdfSettingsDeps = ConstructorParameters<typeof CompanyPdfSettingsService>;

const createService = (prisma: unknown = {}, storage: unknown = {}): CompanyPdfSettingsService =>
  new CompanyPdfSettingsService(
    {
      company: { findFirst: jest.fn().mockResolvedValue({ id: 'company-1' }) },
      apiKeyCompany: { findUnique: jest.fn().mockResolvedValue({}) },
      ...(prisma as object),
    } as unknown as PdfSettingsDeps[0],
    storage as PdfSettingsDeps[1],
  );

const validImage = (mime: 'image/png' | 'image/jpeg'): Buffer => {
  const canvas = createCanvas(2, 2);
  const context = canvas.getContext('2d');
  context.fillStyle = '#123456';
  context.fillRect(0, 0, 2, 2);
  return mime === 'image/png' ? canvas.toBuffer('image/png' as never) : canvas.toBuffer(mime);
};
// SVG fake file
const SVG_CONTENT = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
// Too-large logo (2 MB + 1 byte)
const TOO_LARGE = Buffer.alloc(2 * 1024 * 1024 + 1, 0xff);

describe('CompanyPdfSettingsService — logo security (FR-009)', () => {
  describe('detectImageType (via uploadLogo)', () => {
    it('accepts valid PNG (magic bytes match)', async () => {
      const mockStorage = { upload: jest.fn().mockResolvedValue('key') };
      const mockPrisma = {
        companyPdfSettings: { upsert: jest.fn().mockResolvedValue({}) },
      };
      const svc = createService(mockPrisma, mockStorage);
      const pngBuffer = validImage('image/png');
      await expect(
        svc.uploadLogo({
          tenantId: 'tenant-1',
          companyId: 'company-1',
          authorization: CompanyPdfSettingsService.systemAuthorization(),
          logoBytes: pngBuffer,
          declaredMimeType: 'image/png',
        }),
      ).resolves.not.toThrow();
    });

    it('accepts valid JPEG (magic bytes match)', async () => {
      const mockStorage = { upload: jest.fn().mockResolvedValue('key') };
      const mockPrisma = {
        companyPdfSettings: { upsert: jest.fn().mockResolvedValue({}) },
      };
      const svc = createService(mockPrisma, mockStorage);
      const jpegBuffer = validImage('image/jpeg');
      await expect(
        svc.uploadLogo({
          tenantId: 'tenant-1',
          companyId: 'company-1',
          authorization: CompanyPdfSettingsService.systemAuthorization(),
          logoBytes: jpegBuffer,
          declaredMimeType: 'image/jpeg',
        }),
      ).resolves.not.toThrow();
    });

    it('rejects SVG (no valid image magic bytes)', async () => {
      const svc = createService();
      await expect(
        svc.uploadLogo({
          tenantId: 'tenant-1',
          companyId: 'company-1',
          authorization: CompanyPdfSettingsService.systemAuthorization(),
          logoBytes: SVG_CONTENT,
          declaredMimeType: 'image/svg+xml',
        }),
      ).rejects.toThrow(UnsafeLogoException);
    });

    it('rejects oversized logo (> 2 MB)', async () => {
      const svc = createService();
      await expect(
        svc.uploadLogo({
          tenantId: 'tenant-1',
          companyId: 'company-1',
          authorization: CompanyPdfSettingsService.systemAuthorization(),
          logoBytes: TOO_LARGE,
          declaredMimeType: 'image/png',
        }),
      ).rejects.toThrow(UnsafeLogoException);
    });

    it('rejects empty logo file', async () => {
      const svc = createService();
      await expect(
        svc.uploadLogo({
          tenantId: 'tenant-1',
          companyId: 'company-1',
          authorization: CompanyPdfSettingsService.systemAuthorization(),
          logoBytes: Buffer.alloc(0),
          declaredMimeType: 'image/png',
        }),
      ).rejects.toThrow(UnsafeLogoException);
    });

    it('rejects malformed image (random bytes that are not a valid image type)', async () => {
      const svc = createService();
      const randomBytes = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);
      await expect(
        svc.uploadLogo({
          tenantId: 'tenant-1',
          companyId: 'company-1',
          authorization: CompanyPdfSettingsService.systemAuthorization(),
          logoBytes: randomBytes,
          declaredMimeType: 'image/png',
        }),
      ).rejects.toThrow(UnsafeLogoException);
    });

    it('does NOT trust declared MIME type — validates magic bytes only', async () => {
      const svc = createService();
      // Declare JPEG but provide SVG content — must reject
      await expect(
        svc.uploadLogo({
          tenantId: 'tenant-1',
          companyId: 'company-1',
          authorization: CompanyPdfSettingsService.systemAuthorization(),
          logoBytes: SVG_CONTENT,
          declaredMimeType: 'image/jpeg', // Lies about type
        }),
      ).rejects.toThrow(UnsafeLogoException);
    });
  });

  describe('updateSettings — hex color validation', () => {
    it('accepts valid hex color', async () => {
      const mockPrisma = {
        companyPdfSettings: { upsert: jest.fn().mockResolvedValue({}) },
      };
      const svc = createService(mockPrisma);
      await expect(
        svc.updateSettings({
          tenantId: 'tenant-1',
          companyId: 'company-1',
          authorization: CompanyPdfSettingsService.systemAuthorization(),
          primaryColor: '#1a56db',
        }),
      ).resolves.not.toThrow();
    });

    it('rejects invalid hex color', async () => {
      const svc = createService();
      await expect(
        svc.updateSettings({
          tenantId: 'tenant-1',
          companyId: 'company-1',
          authorization: CompanyPdfSettingsService.systemAuthorization(),
          primaryColor: 'red', // Not a hex color
        }),
      ).rejects.toThrow(UnsafeLogoException);
    });

    it('rejects oversized footer text', async () => {
      const svc = createService();
      await expect(
        svc.updateSettings({
          tenantId: 'tenant-1',
          companyId: 'company-1',
          authorization: CompanyPdfSettingsService.systemAuthorization(),
          footerText: 'A'.repeat(501),
        }),
      ).rejects.toThrow(UnsafeLogoException);
    });
  });
});
