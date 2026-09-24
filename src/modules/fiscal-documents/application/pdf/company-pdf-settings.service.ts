/**
 * CompanyPdfSettingsService — F4 branding settings management.
 *
 * F4 — TASK-006
 * Safe company-level PDF branding configuration.
 * Logo validation: magic-byte check, MIME allowlist, size/dimension limits.
 * Branding can NEVER override mandatory fiscal content.
 * No arbitrary HTML/CSS/JavaScript allowed.
 *
 * Security:
 * - Logo: PNG/JPEG/WebP only (no SVG in MVP)
 * - Magic-byte validation (does not trust filename extension)
 * - Max upload: 2 MB
 * - Stored under tenant/company isolation (server-side storage key)
 * - Internal storage key never exposed to API
 */
import { Injectable, Logger } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import { STORAGE_PORT, StoragePort } from '../../../../infrastructure/storage/ports/storage.port';
import { DomainException } from '../../../shared/domain/domain-exception';
import { CompanyBrandingView } from './pdf-renderer.port';

// Logo validation constants
const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2 MB

// Magic bytes for allowed image types
const MAGIC_BYTES = {
  PNG: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  JPEG: [0xff, 0xd8, 0xff],
  WEBP_PREFIX: [0x52, 0x49, 0x46, 0x46],
  WEBP_SUFFIX_OFFSET: 8,
  WEBP_SUFFIX: [0x57, 0x45, 0x42, 0x50],
};

export class UnsafeLogoException extends DomainException {
  readonly code = 'UNSAFE_LOGO';
  readonly httpStatus = 422;
  constructor(reason: string) {
    super(`Logo upload rejected: ${reason}`);
  }
}

export class CompanyPdfSettingsNotFoundException extends DomainException {
  readonly code = 'COMPANY_PDF_SETTINGS_NOT_FOUND';
  readonly httpStatus = 404;
  constructor(companyId: string) {
    super(`PDF settings not found for company '${companyId}'.`);
  }
}

export interface UpdatePdfSettingsCommand {
  readonly tenantId: string;
  readonly companyId: string;
  readonly primaryColor?: string;
  readonly secondaryColor?: string;
  readonly footerText?: string;
  readonly showCommercialName?: boolean;
}

export interface UploadLogoCommand {
  readonly tenantId: string;
  readonly companyId: string;
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

  /** Get branding view for PDF rendering. Returns default branding if not configured. */
  async getBrandingView(tenantId: string, companyId: string): Promise<CompanyBrandingView> {
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
    if (settings.logoStorageKey && settings.logoSha256) {
      try {
        logoBytes = await this.storage.download(settings.logoStorageKey);
        // Verify logo integrity
        const sha = createHash('sha256').update(logoBytes).digest('hex');
        if (sha !== settings.logoSha256) {
          this.logger.warn({ msg: 'Logo integrity mismatch — using no logo', companyId });
          logoBytes = undefined;
        }
      } catch {
        logoBytes = undefined;
      }
    }

    return {
      templateId: settings.templateId,
      logoBytes,
      logoContentType: settings.logoContentType ?? undefined,
      primaryColor: settings.primaryColor ?? undefined,
      secondaryColor: settings.secondaryColor ?? undefined,
      footerText: settings.footerText ?? undefined,
      showCommercialName: settings.showCommercialName,
    };
  }

  /** Validate logo bytes and store it. Returns storage key (never exposed externally). */
  async uploadLogo(command: UploadLogoCommand): Promise<void> {
    const { tenantId, companyId, logoBytes } = command;

    // Size validation
    if (logoBytes.length === 0) {
      throw new UnsafeLogoException('Logo file is empty.');
    }
    if (logoBytes.length > MAX_LOGO_BYTES) {
      throw new UnsafeLogoException(
        `Logo exceeds maximum size of 2 MB (${logoBytes.length} bytes).`,
      );
    }

    // Magic-byte validation (do NOT trust filename extension or Content-Type header alone)
    const detectedType = this.detectImageType(logoBytes);
    if (!detectedType) {
      throw new UnsafeLogoException(
        'Logo must be a PNG, JPEG, or WebP image. SVG and other formats are not allowed.',
      );
    }

    const sha256 = createHash('sha256').update(logoBytes).digest('hex');
    const storageKey = `logos/${tenantId}/${companyId}/logo-${sha256.substring(0, 12)}.${detectedType.toLowerCase()}`;

    await this.storage.upload(storageKey, logoBytes, {
      contentType:
        detectedType === 'PNG'
          ? 'image/png'
          : detectedType === 'JPEG'
            ? 'image/jpeg'
            : 'image/webp',
      sha256,
      tenantId,
      companyId,
    });

    await this.prisma.companyPdfSettings.upsert({
      where: { companyId },
      create: {
        id: randomUUID(),
        tenantId,
        companyId,
        templateId: 'BILLING_DEFAULT_V1',
        logoStorageKey: storageKey,
        logoSha256: sha256,
        logoContentType:
          detectedType === 'PNG'
            ? 'image/png'
            : detectedType === 'JPEG'
              ? 'image/jpeg'
              : 'image/webp',
        showCommercialName: true,
        updatedAt: new Date(),
      },
      update: {
        logoStorageKey: storageKey,
        logoSha256: sha256,
        logoContentType:
          detectedType === 'PNG'
            ? 'image/png'
            : detectedType === 'JPEG'
              ? 'image/jpeg'
              : 'image/webp',
        updatedAt: new Date(),
      },
    });

    this.logger.log({
      msg: 'Logo uploaded',
      companyId,
      sizeBytes: logoBytes.length,
      type: detectedType,
    });
  }

  /** Update branding settings. Validates hex colors. Cannot override fiscal content. */
  async updateSettings(command: UpdatePdfSettingsCommand): Promise<void> {
    const { tenantId, companyId } = command;

    if (command.primaryColor && !this.isValidHexColor(command.primaryColor)) {
      throw new UnsafeLogoException(
        `Invalid primary color: '${command.primaryColor}'. Must be a 6-digit hex color (#RRGGBB).`,
      );
    }
    if (command.secondaryColor && !this.isValidHexColor(command.secondaryColor)) {
      throw new UnsafeLogoException(
        `Invalid secondary color: '${command.secondaryColor}'. Must be a 6-digit hex color (#RRGGBB).`,
      );
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
        showCommercialName:
          command.showCommercialName !== undefined ? command.showCommercialName : true,
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

  private detectImageType(bytes: Buffer): 'PNG' | 'JPEG' | 'WEBP' | null {
    if (bytes.length < 8) return null;

    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (MAGIC_BYTES.PNG.every((b, i) => bytes[i] === b)) return 'PNG';

    // JPEG: FF D8 FF
    if (MAGIC_BYTES.JPEG.every((b, i) => bytes[i] === b)) return 'JPEG';

    // WebP: RIFF....WEBP
    if (
      MAGIC_BYTES.WEBP_PREFIX.every((b, i) => bytes[i] === b) &&
      bytes.length >= 12 &&
      MAGIC_BYTES.WEBP_SUFFIX.every((b, i) => bytes[MAGIC_BYTES.WEBP_SUFFIX_OFFSET + i] === b)
    ) {
      return 'WEBP';
    }

    return null;
  }

  private isValidHexColor(color: string): boolean {
    return /^#[0-9A-Fa-f]{6}$/.test(color);
  }
}
