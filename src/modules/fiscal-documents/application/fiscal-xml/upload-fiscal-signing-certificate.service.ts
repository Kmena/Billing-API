import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import {
  SECRET_PROVIDER,
  SecretProvider,
} from '../../../../infrastructure/secrets/ports/secret-provider.port';
import { AuditService, EventClass } from '../../../audit/application/audit.service';
import { CrCertificateIdentityExtractorService } from './cr-certificate-identity-extractor.service';
import {
  FiscalCertificateConcurrentActivationException,
  FiscalCertificateEmitterMismatchException,
  FiscalCertificateExpiredException,
  FiscalCertificateFileTooLargeException,
  FiscalCertificateNotYetValidException,
  FiscalCertificatePersistFailedException,
  FiscalCertificateStorageFailedException,
} from '../../domain/fiscal-xml/exceptions/fiscal-certificate.exceptions';

/** PostgreSQL partial unique index name for one ACTIVE cert per scope. */
const ACTIVE_CERT_UNIQUE_INDEX = 'fiscal_signing_cert_one_active_per_scope';

/** Maximum allowed PKCS#12 file size in bytes (default 1 MB). */
export const DEFAULT_CERT_MAX_SIZE_BYTES = 1_048_576;

export interface UploadFiscalSigningCertificateCommand {
  readonly tenantId: string;
  readonly companyId: string;
  /** Hacienda environment enum value (e.g. 'SANDBOX' | 'PRODUCTION'). */
  readonly environment: string;
  /** Raw PKCS#12 bytes. Never persisted to disk. */
  readonly pkcs12Bytes: Buffer;
  /** Certificate PIN. Never persisted in plaintext. */
  readonly pin: string;
  /** Actor userId for audit trail. */
  readonly actorUserId: string;
  /** Maximum file size override (bytes). Defaults to DEFAULT_CERT_MAX_SIZE_BYTES. */
  readonly maxFileSizeBytes?: number;
}

export interface UploadFiscalSigningCertificateResult {
  readonly id: string;
  readonly companyId: string;
  readonly environment: string;
  readonly status: string;
  readonly fingerprintSha256: string | null;
  readonly serialNumber: string | null;
  readonly subjectName: string | null;
  readonly issuerName: string | null;
  readonly validFrom: Date | null;
  readonly validTo: Date | null;
  readonly extractedIdentityNumber: string | null;
  readonly extractedIdentityType: string | null;
  readonly activeFrom: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * UploadFiscalSigningCertificateService — TASK-002
 *
 * 14-step secure certificate upload application service.
 * Validates PKCS#12, compares fiscal identity with company, validates dates,
 * stores secrets via SecretProvider, and persists only safe metadata.
 *
 * Security invariants:
 * - PKCS#12 bytes never written to disk
 * - PIN never persisted in plaintext
 * - PostgreSQL contains only SecretProvider references and safe metadata
 * - AuditService metadata contains no PIN, no bytes, no private key
 * - Rotation: old ACTIVE cert remains ACTIVE until full success
 */
@Injectable()
export class UploadFiscalSigningCertificateService {
  private readonly logger = new Logger(UploadFiscalSigningCertificateService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SECRET_PROVIDER) private readonly secrets: SecretProvider,
    private readonly extractor: CrCertificateIdentityExtractorService,
    private readonly audit: AuditService,
  ) {}

  async execute(
    command: UploadFiscalSigningCertificateCommand,
  ): Promise<UploadFiscalSigningCertificateResult> {
    const maxSize = command.maxFileSizeBytes ?? DEFAULT_CERT_MAX_SIZE_BYTES;

    // Step 1: Validate file size
    if (command.pkcs12Bytes.length > maxSize) {
      throw new FiscalCertificateFileTooLargeException(maxSize);
    }

    // Step 2: Load Company (must exist, must be ACTIVE, tenant-scoped)
    const company = await this.prisma.company.findFirst({
      where: {
        id: command.companyId,
        tenantId: command.tenantId,
        status: 'ACTIVE',
      },
      select: {
        id: true,
        tenantId: true,
        identificationNumber: true,
      },
    });
    if (!company) {
      throw new NotFoundException({
        code: 'COMPANY_NOT_FOUND',
        message: 'Company not found or not accessible.',
      });
    }

    // Steps 3-7: Extract and validate the PKCS#12 (sanitized errors propagate up)
    const extracted = this.extractor.extractAndValidate(command.pkcs12Bytes, command.pin);

    // Step 8: Compare extracted identity with Company identity
    const certId = extracted.extractedIdentityNumber.trim().toLowerCase();
    const companyId = company.identificationNumber.trim().toLowerCase();
    if (certId !== companyId) {
      this.audit.record({
        tenantId: command.tenantId,
        companyId: command.companyId,
        action: 'fiscal-certificate.upload-rejected',
        eventClass: EventClass.SECURITY,
        metadata: {
          reason: 'FISCAL_CERTIFICATE_EMITTER_MISMATCH',
          environment: command.environment,
          actor: command.actorUserId,
        },
      });
      throw new FiscalCertificateEmitterMismatchException();
    }

    // Step 9: Validate certificate dates
    const now = new Date();
    if (extracted.validTo <= now) {
      throw new FiscalCertificateExpiredException();
    }
    if (extracted.validFrom > now) {
      throw new FiscalCertificateNotYetValidException();
    }

    // Step 10: Build secret reference keys (deterministic, non-guessable)
    const certRef = `fiscal-certs/${command.companyId}/${command.environment.toLowerCase()}/cert-${extracted.fingerprintSha256}`;
    const pinRef = `fiscal-certs/${command.companyId}/${command.environment.toLowerCase()}/pin-${extracted.fingerprintSha256}`;

    // Step 11-12: Store secrets via SecretProvider
    try {
      await this.secrets.storeSecret(
        certRef,
        JSON.stringify({ pkcs12Base64: command.pkcs12Bytes.toString('base64') }),
      );
    } catch {
      throw new FiscalCertificateStorageFailedException();
    }

    try {
      await this.secrets.storeSecret(pinRef, command.pin);
    } catch {
      // Roll back the cert secret
      await this.attemptCleanupSecret(certRef);
      throw new FiscalCertificateStorageFailedException();
    }

    // Steps 13-14: DB transaction — mark old ACTIVE as REPLACED, insert new ACTIVE
    const newId = randomUUID();
    const now2 = new Date();
    let newCertRecord: UploadFiscalSigningCertificateResult;

    try {
      newCertRecord = await this.prisma.$transaction(async (tx) => {
        // Find existing ACTIVE cert for this company + environment
        const existingActive = await tx.fiscalSigningCertificate.findFirst({
          where: {
            tenantId: command.tenantId,
            companyId: command.companyId,
            environment: command.environment as 'PRODUCTION' | 'SANDBOX',
            status: 'ACTIVE',
          },
          select: { id: true },
        });

        if (existingActive) {
          await tx.fiscalSigningCertificate.update({
            where: { id: existingActive.id },
            data: { status: 'REPLACED', replacedById: newId },
          });
        }

        return tx.fiscalSigningCertificate.create({
          data: {
            id: newId,
            tenantId: command.tenantId,
            companyId: command.companyId,
            environment: command.environment as 'PRODUCTION' | 'SANDBOX',
            status: 'ACTIVE',
            certificateType: 'HACIENDA_CRYPTOGRAPHIC_KEY',
            certificateSecretReference: certRef,
            passwordSecretReference: pinRef,
            fingerprintSha256: extracted.fingerprintSha256,
            serialNumber: extracted.x509SerialNumber,
            subjectName: extracted.subjectName,
            issuerName: extracted.issuerName,
            validFrom: extracted.validFrom,
            validTo: extracted.validTo,
            extractedIdentityNumber: extracted.extractedIdentityNumber,
            extractedIdentityType: extracted.extractedIdentityType,
            activeFrom: now2,
          },
        });
      });
    } catch (err) {
      // DB-002: Map partial unique index violation to a safe domain error.
      // Prisma surfaces a P2002 when fiscal_signing_cert_one_active_per_scope is violated
      // (two concurrent activations for the same tenant/company/environment).
      // Duck-type the error to avoid a @prisma/client import at this layer (lint rule).
      // Prisma P2002 errors are plain objects with a 'code' and 'meta' property.
      const prismaErr = err as { code?: string; meta?: { target?: unknown } };
      if (prismaErr.code === 'P2002') {
        const target = prismaErr.meta?.target;
        const isActiveConstraint =
          target === ACTIVE_CERT_UNIQUE_INDEX ||
          (Array.isArray(target) && (target as string[]).includes(ACTIVE_CERT_UNIQUE_INDEX));
        if (isActiveConstraint) {
          // Clean up the orphan secrets we already stored
          await this.attemptCleanupSecret(certRef);
          await this.attemptCleanupSecret(pinRef);
          throw new FiscalCertificateConcurrentActivationException();
        }
      }
      // All other DB errors — attempt compensating cleanup
      await this.attemptCleanupSecret(certRef);
      await this.attemptCleanupSecret(pinRef);
      this.logger.error(
        { companyId: command.companyId, environment: command.environment, error: String(err) },
        'Certificate DB transaction failed — compensating secret cleanup attempted',
      );
      throw new FiscalCertificatePersistFailedException();
    }

    // Emit success audit event (no secrets in metadata)
    this.audit.record({
      tenantId: command.tenantId,
      companyId: command.companyId,
      action: 'fiscal-certificate.activated',
      eventClass: EventClass.SECURITY,
      metadata: {
        certificateId: newId,
        environment: command.environment,
        fingerprintSha256: extracted.fingerprintSha256,
        subjectName: extracted.subjectName,
        actor: command.actorUserId,
      },
    });

    return {
      id: newCertRecord.id,
      companyId: newCertRecord.companyId,
      environment: newCertRecord.environment,
      status: newCertRecord.status,
      fingerprintSha256: newCertRecord.fingerprintSha256,
      serialNumber: newCertRecord.serialNumber,
      subjectName: newCertRecord.subjectName,
      issuerName: newCertRecord.issuerName,
      validFrom: newCertRecord.validFrom,
      validTo: newCertRecord.validTo,
      extractedIdentityNumber: newCertRecord.extractedIdentityNumber,
      extractedIdentityType: newCertRecord.extractedIdentityType,
      activeFrom: newCertRecord.activeFrom,
      createdAt: newCertRecord.createdAt,
      updatedAt: newCertRecord.updatedAt,
    };
  }

  private async attemptCleanupSecret(key: string): Promise<void> {
    try {
      await this.secrets.deleteSecret(key);
    } catch (err) {
      this.logger.warn(
        { key, error: String(err) },
        'Certificate upload: compensating secret cleanup failed — orphan secret may exist',
      );
    }
  }
}
