/**
 * CompanyPdfSettingsService unit tests — F4 TASK-006
 * Tests: logo security (MIME magic-byte validation), branding isolation from fiscal content.
 */
import { CompanyPdfSettingsService } from '../company-pdf-settings.service';
import { UnsafeLogoException } from '../company-pdf-settings.service';

type PdfSettingsDeps = ConstructorParameters<typeof CompanyPdfSettingsService>;

const createService = (prisma: unknown = {}, storage: unknown = {}): CompanyPdfSettingsService =>
  new CompanyPdfSettingsService(prisma as PdfSettingsDeps[0], storage as PdfSettingsDeps[1]);

// PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// JPEG magic bytes: FF D8 FF
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
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
      // Build a fake PNG (magic + padding)
      const pngBuffer = Buffer.concat([PNG_MAGIC, Buffer.alloc(100, 0)]);
      await expect(
        svc.uploadLogo({
          tenantId: 'tenant-1',
          companyId: 'company-1',
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
      const jpegBuffer = Buffer.concat([JPEG_MAGIC, Buffer.alloc(100, 0)]);
      await expect(
        svc.uploadLogo({
          tenantId: 'tenant-1',
          companyId: 'company-1',
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
          footerText: 'A'.repeat(501),
        }),
      ).rejects.toThrow(UnsafeLogoException);
    });
  });
});
