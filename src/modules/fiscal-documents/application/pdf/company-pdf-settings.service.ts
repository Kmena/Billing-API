import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import * as PDFDocument from 'pdfkit';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import { STORAGE_PORT, StoragePort } from '../../../../infrastructure/storage/ports/storage.port';
import { DomainException } from '../../../shared/domain/domain-exception';
import { CompanyBrandingView } from './pdf-renderer.port';

export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
export const MAX_LOGO_WIDTH = 2048;
export const MAX_LOGO_HEIGHT = 2048;
export const MAX_LOGO_PIXELS = 4_194_304;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const SYSTEM_BRANDING_AUTHORIZATION = { kind: 'SYSTEM' } as const;

type LogoType = 'PNG' | 'JPEG';
type BrandingOperation = 'READ' | 'MUTATE';

export type BrandingAuthorizationContext =
  | Readonly<{ kind: 'SYSTEM' }>
  | Readonly<{ kind: 'API_KEY'; apiKeyId: string; scopes: readonly string[] }>;

export class UnsafeLogoException extends DomainException {
  readonly code = 'LOGO_INVALID';
  readonly httpStatus = 422;
  constructor(reason: string) {
    super(`Logo upload rejected: ${reason}`);
  }
}

export class CompanyPdfSettingsNotFoundException extends DomainException {
  readonly code = 'COMPANY_PDF_SETTINGS_NOT_FOUND';
  readonly httpStatus = 404;
  constructor() {
    super('Company PDF settings were not found.');
  }
}

export class CompanyPdfSettingsAccessDeniedException extends DomainException {
  readonly code = 'BRANDING_UNAUTHORIZED';
  readonly httpStatus = 403;
  constructor() {
    super('Branding access is not authorized for this company.');
  }
}

export interface UpdatePdfSettingsCommand {
  readonly tenantId: string;
  readonly companyId: string;
  readonly authorization: BrandingAuthorizationContext;
  readonly primaryColor?: string;
  readonly secondaryColor?: string;
  readonly footerText?: string;
  readonly showCommercialName?: boolean;
}

export interface UploadLogoCommand {
  readonly tenantId: string;
  readonly companyId: string;
  readonly authorization: BrandingAuthorizationContext;
  readonly logoBytes: Buffer;
  readonly declaredMimeType: string;
}

@Injectable()
export class CompanyPdfSettingsService {
  private readonly logger = new Logger(CompanyPdfSettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
  ) {}

  async getBrandingView(
    tenantId: string,
    companyId: string,
    authorization: BrandingAuthorizationContext,
  ): Promise<CompanyBrandingView> {
    await this.assertAuthorized(tenantId, companyId, authorization, 'READ');
    const settings = await this.prisma.companyPdfSettings.findFirst({
      where: { tenantId, companyId },
    });

    if (!settings) {
      return {
        templateId: 'BILLING_DEFAULT_V1',
        showCommercialName: true,
      };
    }

    let logoBytes: Buffer | undefined;
    if (settings.logoStorageKey && settings.logoSha256 && settings.logoContentType) {
      try {
        const candidate = await this.storage.download(settings.logoStorageKey);
        const sha = createHash('sha256').update(candidate).digest('hex');
        if (sha !== settings.logoSha256) {
          this.logger.warn({ msg: 'Logo integrity mismatch — using no logo', companyId });
        } else {
          this.validateAndInspectLogo(candidate, settings.logoContentType);
          logoBytes = candidate;
        }
      } catch {
        logoBytes = undefined;
      }
    }

    return {
      templateId: settings.templateId,
      logoBytes,
      logoContentType: logoBytes ? (settings.logoContentType ?? undefined) : undefined,
      primaryColor: settings.primaryColor ?? undefined,
      secondaryColor: settings.secondaryColor ?? undefined,
      footerText: settings.footerText ?? undefined,
      showCommercialName: settings.showCommercialName,
    };
  }

  async uploadLogo(command: UploadLogoCommand): Promise<void> {
    const { tenantId, companyId } = command;
    await this.assertAuthorized(tenantId, companyId, command.authorization, 'MUTATE');

    if (!Buffer.isBuffer(command.logoBytes)) {
      throw new UnsafeLogoException('Logo input must be an in-memory buffer.');
    }
    const { type, contentType } = this.validateAndInspectLogo(
      command.logoBytes,
      command.declaredMimeType,
    );
    const sha256 = createHash('sha256').update(command.logoBytes).digest('hex');
    const storageKey =
      `logos/${tenantId}/${companyId}/logo-${sha256.substring(0, 12)}-` +
      `${randomUUID()}.${type.toLowerCase()}`;

    await this.storage.upload({
      key: storageKey,
      bytes: command.logoBytes,
      contentType,
      metadata: { sha256, tenantId, companyId },
    });

    try {
      await this.prisma.companyPdfSettings.upsert({
        where: { companyId },
        create: {
          id: randomUUID(),
          tenantId,
          companyId,
          templateId: 'BILLING_DEFAULT_V1',
          logoStorageKey: storageKey,
          logoSha256: sha256,
          logoContentType: contentType,
          showCommercialName: true,
          updatedAt: new Date(),
        },
        update: {
          logoStorageKey: storageKey,
          logoSha256: sha256,
          logoContentType: contentType,
          updatedAt: new Date(),
        },
      });
    } catch (error: unknown) {
      try {
        await this.storage.delete(storageKey);
      } catch {
        this.logger.warn({ msg: 'Logo compensation delete failed', companyId });
      }
      throw error;
    }

    this.logger.log({
      msg: 'Logo uploaded',
      companyId,
      sizeBytes: command.logoBytes.length,
      type,
    });
  }

  async updateSettings(command: UpdatePdfSettingsCommand): Promise<void> {
    const { tenantId, companyId } = command;
    await this.assertAuthorized(tenantId, companyId, command.authorization, 'MUTATE');

    if (command.primaryColor && !this.isValidHexColor(command.primaryColor)) {
      throw new UnsafeLogoException('Primary color must be a 6-digit hex color (#RRGGBB).');
    }
    if (command.secondaryColor && !this.isValidHexColor(command.secondaryColor)) {
      throw new UnsafeLogoException('Secondary color must be a 6-digit hex color (#RRGGBB).');
    }
    if (command.footerText && command.footerText.length > 500) {
      throw new UnsafeLogoException('Footer text exceeds 500 character limit.');
    }

    await this.prisma.companyPdfSettings.upsert({
      where: { companyId },
      create: {
        id: randomUUID(),
        tenantId,
        companyId,
        templateId: 'BILLING_DEFAULT_V1',
        primaryColor: command.primaryColor ?? null,
        secondaryColor: command.secondaryColor ?? null,
        footerText: command.footerText ?? null,
        showCommercialName: command.showCommercialName ?? true,
        updatedAt: new Date(),
      },
      update: {
        ...(command.primaryColor !== undefined ? { primaryColor: command.primaryColor } : {}),
        ...(command.secondaryColor !== undefined ? { secondaryColor: command.secondaryColor } : {}),
        ...(command.footerText !== undefined ? { footerText: command.footerText } : {}),
        ...(command.showCommercialName !== undefined
          ? { showCommercialName: command.showCommercialName }
          : {}),
        updatedAt: new Date(),
      },
    });
  }

  static systemAuthorization(): BrandingAuthorizationContext {
    return SYSTEM_BRANDING_AUTHORIZATION;
  }

  private async assertAuthorized(
    tenantId: string,
    companyId: string,
    authorization: BrandingAuthorizationContext,
    operation: BrandingOperation,
  ): Promise<void> {
    const company = await this.prisma.company.findFirst({
      where: { id: companyId, tenantId },
      select: { id: true },
    });
    if (!company) throw new CompanyPdfSettingsNotFoundException();
    if (authorization.kind === 'SYSTEM') return;

    const binding = await this.prisma.apiKeyCompany.findUnique({
      where: {
        apiKeyId_companyId: {
          apiKeyId: authorization.apiKeyId,
          companyId,
        },
      },
    });
    if (!binding) throw new CompanyPdfSettingsAccessDeniedException();

    const hasScope =
      operation === 'MUTATE'
        ? authorization.scopes.includes('invoices:write')
        : authorization.scopes.includes('invoices:read') ||
          authorization.scopes.includes('tickets:read');
    if (!hasScope) throw new CompanyPdfSettingsAccessDeniedException();
  }

  private validateAndInspectLogo(
    bytes: Buffer,
    declaredMimeType: string,
  ): { type: LogoType; contentType: 'image/png' | 'image/jpeg' } {
    if (bytes.length === 0) throw new UnsafeLogoException('Logo file is empty.');
    if (bytes.length > MAX_LOGO_BYTES) {
      throw new UnsafeLogoException('Logo exceeds the 2 MiB encoded-byte limit.');
    }

    const type = this.detectImageType(bytes);
    if (!type) {
      throw new UnsafeLogoException('Only PNG and JPEG logo buffers are allowed.');
    }
    const contentType = type === 'PNG' ? 'image/png' : 'image/jpeg';
    if (declaredMimeType.toLowerCase() !== contentType) {
      throw new UnsafeLogoException('Declared MIME type does not match image magic bytes.');
    }

    const headerDimensions =
      type === 'PNG' ? this.readPngDimensions(bytes) : this.readJpegDimensions(bytes);
    this.assertDimensions(headerDimensions.width, headerDimensions.height);

    const document = new PDFDocument({ autoFirstPage: false });
    try {
      const image = (
        document as unknown as {
          openImage(source: Buffer): { width: number; height: number };
        }
      ).openImage(bytes);
      if (image.width !== headerDimensions.width || image.height !== headerDimensions.height) {
        throw new UnsafeLogoException('Decoded image dimensions do not match its header.');
      }
      this.assertDimensions(image.width, image.height);
    } catch (error: unknown) {
      if (error instanceof UnsafeLogoException) throw error;
      throw new UnsafeLogoException('Image decode failed.');
    } finally {
      document.destroy();
    }

    return { type, contentType };
  }

  private detectImageType(bytes: Buffer): LogoType | null {
    if (bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) return 'PNG';
    if (bytes.subarray(0, JPEG_MAGIC.length).equals(JPEG_MAGIC)) return 'JPEG';
    return null;
  }

  private readPngDimensions(bytes: Buffer): { width: number; height: number } {
    if (
      bytes.length < 24 ||
      bytes.toString('ascii', 12, 16) !== 'IHDR' ||
      bytes.readUInt32BE(8) !== 13
    ) {
      throw new UnsafeLogoException('PNG header is malformed or truncated.');
    }
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }

  private readJpegDimensions(bytes: Buffer): { width: number; height: number } {
    const startOfFrame = new Set([
      0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
    ]);
    let offset = 2;
    while (offset + 3 < bytes.length) {
      if (bytes[offset] !== 0xff) throw new UnsafeLogoException('JPEG marker stream is invalid.');
      while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
      const marker = bytes[offset];
      offset += 1;
      if (marker === 0xd8 || marker === 0xd9) continue;
      if (marker === 0xda) break;
      if (offset + 2 > bytes.length) break;
      const segmentLength = bytes.readUInt16BE(offset);
      if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
      if (startOfFrame.has(marker)) {
        if (segmentLength < 7) break;
        return {
          height: bytes.readUInt16BE(offset + 3),
          width: bytes.readUInt16BE(offset + 5),
        };
      }
      offset += segmentLength;
    }
    throw new UnsafeLogoException('JPEG dimensions are missing or malformed.');
  }

  private assertDimensions(width: number, height: number): void {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new UnsafeLogoException('Image dimensions are invalid.');
    }
    if (width > MAX_LOGO_WIDTH || height > MAX_LOGO_HEIGHT) {
      throw new UnsafeLogoException('Image dimensions exceed 2048 × 2048.');
    }
    if (width * height > MAX_LOGO_PIXELS) {
      throw new UnsafeLogoException('Image pixel count exceeds 4,194,304.');
    }
  }

  private isValidHexColor(color: string): boolean {
    return /^#[0-9A-Fa-f]{6}$/.test(color);
  }
}
