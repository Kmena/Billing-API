/**
 * FiscalCertificateController — TASK-003
 *
 * Exposes PKCS#12 certificate upload, rotation, and metadata read for a company.
 *
 * Security invariants:
 * - PKCS#12 bytes use multer.memoryStorage() — never written to disk.
 * - PIN comes from multipart body field — never from query params or headers.
 * - Response DTO never includes certificateSecretReference, passwordSecretReference,
 *   PKCS#12 bytes, private key material, or PIN.
 * - Authorization: JwtAuthGuard + TENANT_ADMIN role required for writes.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Request,
  UnauthorizedException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import multer = require('multer');
import { JwtAuthGuard } from '../../../../api/guards/jwt-auth.guard';
import type { JwtRequest } from '../../../../api/strategies/jwt.strategy';
import { UploadFiscalSigningCertificateService } from '../../application/fiscal-xml/upload-fiscal-signing-certificate.service';
import { FiscalReadCertificateMetadataService } from '../../application/fiscal-xml/fiscal-read-certificate-metadata.service';
import { FiscalReadinessService } from '../../application/fiscal-xml/fiscal-readiness.service';

/** Maximum allowed certificate file size in bytes. Configurable via env var. */
const FISCAL_CERT_MAX_SIZE_BYTES = parseInt(
  process.env.FISCAL_CERT_MAX_SIZE_BYTES ?? '1048576',
  10,
);

@ApiTags('Fiscal Certificate Management')
@SkipThrottle()
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('companies/:companyId/fiscal-certificates')
export class FiscalCertificateController {
  constructor(
    private readonly uploadService: UploadFiscalSigningCertificateService,
    private readonly readMetadataService: FiscalReadCertificateMetadataService,
    private readonly readinessService: FiscalReadinessService,
  ) {}

  /**
   * POST /companies/:companyId/fiscal-certificates/:environment
   *
   * Upload and activate a new PKCS#12 signing certificate for a company.
   * If a certificate already exists, it will be replaced atomically (rotation).
   * Auth: JWT — TENANT_ADMIN only.
   * Content-Type: multipart/form-data
   * Body fields:
   *   - certificate (file): PKCS#12 .p12 file
   *   - pin (string): certificate PIN
   */
  @Post(':environment')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Upload or rotate signing certificate (TENANT_ADMIN)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('certificate', {
      // CRITICAL: override the module-level disk storage with memory storage
      // to ensure the PKCS#12 bytes never touch the filesystem.
      storage: multer.memoryStorage(),
      limits: { fileSize: FISCAL_CERT_MAX_SIZE_BYTES },
    }),
  )
  async uploadCertificate(
    @Request() req: { user: JwtRequest },
    @Param('companyId') companyId: string,
    @Param('environment') environment: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('pin') pin: string | undefined,
  ) {
    this.assertTenantAdmin(req.user);

    if (!file || !file.buffer) {
      throw new BadRequestException({
        code: 'FISCAL_CERTIFICATE_FILE_REQUIRED',
        message: 'A PKCS#12 certificate file is required (field name: certificate).',
      });
    }
    if (!pin || pin.trim() === '') {
      throw new BadRequestException({
        code: 'FISCAL_CERTIFICATE_PIN_REQUIRED',
        message: 'A certificate PIN is required (field name: pin).',
      });
    }
    if (file.size > FISCAL_CERT_MAX_SIZE_BYTES) {
      throw new BadRequestException({
        code: 'FISCAL_CERTIFICATE_FILE_TOO_LARGE',
        message: `Certificate file exceeds ${FISCAL_CERT_MAX_SIZE_BYTES} bytes.`,
      });
    }

    try {
      const result = await this.uploadService.execute({
        tenantId: req.user.tenantId,
        companyId,
        environment,
        pkcs12Bytes: file.buffer,
        pin,
        actorUserId: req.user.userId,
        maxFileSizeBytes: FISCAL_CERT_MAX_SIZE_BYTES,
      });

      return this.toMetadataResponse(result);
    } finally {
      // Discard buffer reference immediately after use (GC handles cleanup)
    }
  }

  /**
   * PUT /companies/:companyId/fiscal-certificates/:environment
   *
   * Rotate/replace the existing ACTIVE certificate.
   * Delegates to the same upload service (rotation is handled in the service layer).
   * Auth: JWT — TENANT_ADMIN only.
   */
  @Put(':environment')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate signing certificate (TENANT_ADMIN)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('certificate', {
      storage: multer.memoryStorage(),
      limits: { fileSize: FISCAL_CERT_MAX_SIZE_BYTES },
    }),
  )
  async rotateCertificate(
    @Request() req: { user: JwtRequest },
    @Param('companyId') companyId: string,
    @Param('environment') environment: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('pin') pin: string | undefined,
  ) {
    this.assertTenantAdmin(req.user);

    if (!file || !file.buffer) {
      throw new BadRequestException({
        code: 'FISCAL_CERTIFICATE_FILE_REQUIRED',
        message: 'A PKCS#12 certificate file is required (field name: certificate).',
      });
    }
    if (!pin || pin.trim() === '') {
      throw new BadRequestException({
        code: 'FISCAL_CERTIFICATE_PIN_REQUIRED',
        message: 'A certificate PIN is required (field name: pin).',
      });
    }

    try {
      const result = await this.uploadService.execute({
        tenantId: req.user.tenantId,
        companyId,
        environment,
        pkcs12Bytes: file.buffer,
        pin,
        actorUserId: req.user.userId,
        maxFileSizeBytes: FISCAL_CERT_MAX_SIZE_BYTES,
      });

      return this.toMetadataResponse(result);
    } finally {
      // Discard buffer reference immediately after use
    }
  }

  /**
   * GET /companies/:companyId/fiscal-certificates/:environment
   *
   * Read active certificate safe metadata (no secrets).
   * Auth: JWT — any authenticated user.
   */
  @Get(':environment')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get active certificate safe metadata' })
  async getCertificateMetadata(
    @Request() req: { user: JwtRequest },
    @Param('companyId') companyId: string,
    @Param('environment') environment: string,
  ) {
    const result = await this.readMetadataService.execute({
      tenantId: req.user.tenantId,
      companyId,
      environment,
    });
    return this.toMetadataResponse(result);
  }

  /**
   * GET /companies/:companyId/fiscal-certificates/:environment/readiness
   *
   * Evaluate fiscal readiness — returns readyToIssue + reason codes.
   * Never returns secrets.
   * Auth: JWT — any authenticated user.
   */
  @Get(':environment/readiness')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Evaluate fiscal readiness for a company and environment' })
  async getFiscalReadiness(
    @Request() req: { user: JwtRequest },
    @Param('companyId') companyId: string,
    @Param('environment') environment: string,
  ) {
    const result = await this.readinessService.evaluate({
      tenantId: req.user.tenantId,
      companyId,
      environment,
    });
    return result;
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private assertTenantAdmin(user: JwtRequest): void {
    if (user.role !== 'TENANT_ADMIN') {
      throw new UnauthorizedException({
        code: 'INSUFFICIENT_ROLE',
        message: 'Certificate management requires TENANT_ADMIN role.',
      });
    }
  }

  private toMetadataResponse(result: {
    id: string;
    companyId: string;
    environment: string;
    status: string;
    fingerprintSha256?: string | null;
    serialNumber?: string | null;
    subjectName?: string | null;
    issuerName?: string | null;
    validFrom?: Date | null;
    validTo?: Date | null;
    extractedIdentityNumber?: string | null;
    extractedIdentityType?: string | null;
    activeFrom?: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    // Explicitly construct response — never spread or include secret references
    return {
      id: result.id,
      companyId: result.companyId,
      environment: result.environment,
      status: result.status,
      fingerprintSha256: result.fingerprintSha256 ?? null,
      serialNumber: result.serialNumber ?? null,
      subjectName: result.subjectName ?? null,
      issuerName: result.issuerName ?? null,
      validFrom: result.validFrom ?? null,
      validTo: result.validTo ?? null,
      extractedIdentityNumber: result.extractedIdentityNumber ?? null,
      extractedIdentityType: result.extractedIdentityType ?? null,
      activeFrom: result.activeFrom ?? null,
      createdAt: result.createdAt,
      updatedAt: result.updatedAt,
    };
  }
}
