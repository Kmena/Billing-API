import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../../infrastructure/database/prisma.service';
import { AuditService, EventClass } from '../../../../audit/application/audit.service';
import { FiscalCertificateIdentityConflictException } from '../../../../fiscal-documents/domain/fiscal-xml/exceptions/fiscal-certificate.exceptions';

/**
 * Map from numeric Costa Rica OID identification-type codes (as stored in
 * `extractedIdentityType` on FiscalSigningCertificate) to the Prisma enum
 * value used in Company.identificationType.
 */
const CERT_TYPE_CODE_TO_PRISMA: Record<string, string> = {
  '01': 'FISICA',
  '02': 'JURIDICA',
  '03': 'DIMEX',
  '04': 'NITE',
};

export interface UpdateCompanyCommand {
  readonly tenantId: string;
  readonly companyId: string;
  readonly actorUserId: string;
  readonly legalName?: string;
  readonly tradeName?: string;
  /** When provided, triggers identity-change validation. */
  readonly identificationType?: string;
  /** When provided, triggers identity-change validation. */
  readonly identificationNumber?: string;
}

export interface UpdateCompanyResult {
  readonly id: string;
  readonly tenantId: string;
  readonly legalName: string;
  readonly tradeName: string | null;
  readonly identificationType: string;
  readonly identificationNumber: string;
  readonly status: string;
  readonly updatedAt: Date;
}

/**
 * UpdateCompanyHandler — TASK-006
 *
 * Applies partial updates to a Company. When `identificationType` or
 * `identificationNumber` change, validates against the currently ACTIVE
 * signing certificate (DEC-003: BLOCK on incompatible identity change).
 *
 * Invariants:
 * - Only the authenticated tenant's company may be updated.
 * - An ACTIVE certificate whose extractedIdentityNumber would become
 *   incompatible blocks the update. No certificate is modified.
 * - Unrelated field updates (legalName, tradeName) always succeed.
 */
@Injectable()
export class UpdateCompanyHandler {
  private readonly logger = new Logger(UpdateCompanyHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async execute(command: UpdateCompanyCommand): Promise<UpdateCompanyResult> {
    // Load current company — tenant-scoped
    const current = await this.prisma.company.findFirst({
      where: { id: command.companyId, tenantId: command.tenantId },
      select: {
        id: true,
        tenantId: true,
        legalName: true,
        tradeName: true,
        identificationNumber: true,
        identificationType: true,
        status: true,
        updatedAt: true,
      },
    });
    if (!current) {
      throw new NotFoundException({
        code: 'COMPANY_NOT_FOUND',
        message: 'Company not found or not accessible.',
      });
    }

    const newIdentityType = command.identificationType ?? current.identificationType;
    const newIdentityNumber = command.identificationNumber ?? current.identificationNumber;

    const identityWouldChange =
      newIdentityType !== current.identificationType ||
      newIdentityNumber !== current.identificationNumber;

    if (identityWouldChange) {
      await this.assertNoCertificateIdentityConflict({
        tenantId: command.tenantId,
        companyId: command.companyId,
        newIdentityType,
        newIdentityNumber,
      });
    }

    // Apply the update
    const updated = await this.prisma.company.update({
      where: { id: command.companyId },
      data: {
        legalName: command.legalName !== undefined ? command.legalName.trim() : undefined,
        tradeName: command.tradeName !== undefined ? command.tradeName.trim() || null : undefined,
        identificationNumber: command.identificationNumber,
        // identificationType is already validated as 'FISICA'|'JURIDICA'|'DIMEX'|'NITE'
        // by UpdateCompanyRequestDto @IsEnum — no runtime cast required.
        identificationType: command.identificationType as
          'FISICA' | 'JURIDICA' | 'DIMEX' | 'NITE' | undefined,
      },
      select: {
        id: true,
        tenantId: true,
        legalName: true,
        tradeName: true,
        identificationNumber: true,
        identificationType: true,
        status: true,
        updatedAt: true,
      },
    });

    // Audit the change
    this.audit.record({
      tenantId: command.tenantId,
      companyId: command.companyId,
      action: identityWouldChange ? 'company.identity-updated' : 'company.updated',
      eventClass: identityWouldChange ? EventClass.SECURITY : EventClass.TECHNICAL,
      metadata: {
        actor: command.actorUserId,
        fieldsChanged: Object.keys(command).filter(
          (k) => k !== 'tenantId' && k !== 'companyId' && k !== 'actorUserId',
        ),
      },
    });

    return {
      id: updated.id,
      tenantId: updated.tenantId,
      legalName: updated.legalName,
      tradeName: updated.tradeName,
      identificationType: updated.identificationType,
      identificationNumber: updated.identificationNumber,
      status: updated.status,
      updatedAt: updated.updatedAt,
    };
  }

  /**
   * DEC-003: Block identity changes that are incompatible with the ACTIVE certificate.
   * Only enforced when the ACTIVE certificate has extractedIdentityNumber set.
   * Cross-tenant certificates have zero effect (tenant scope is enforced in the DB query).
   */
  private async assertNoCertificateIdentityConflict(params: {
    tenantId: string;
    companyId: string;
    newIdentityType: string;
    newIdentityNumber: string;
  }): Promise<void> {
    const activeCert = await this.prisma.fiscalSigningCertificate.findFirst({
      where: {
        tenantId: params.tenantId,
        companyId: params.companyId,
        status: 'ACTIVE',
      },
      select: {
        id: true,
        extractedIdentityNumber: true,
        extractedIdentityType: true,
      },
    });

    if (!activeCert || !activeCert.extractedIdentityNumber) {
      // No ACTIVE cert, or cert was uploaded before the new extraction logic — allow update
      return;
    }

    const certId = activeCert.extractedIdentityNumber.trim().toLowerCase();
    const newId = params.newIdentityNumber.trim().toLowerCase();
    const numberConflict = certId !== newId;

    // extractedIdentityType is a numeric code ('01'|'02'|'03'|'04') from the certificate OID.
    // Company.identificationType is the Prisma enum ('FISICA'|'JURIDICA'|'DIMEX'|'NITE').
    // Map the cert code before comparing.
    const certTypePrisma =
      activeCert.extractedIdentityType !== null
        ? (CERT_TYPE_CODE_TO_PRISMA[activeCert.extractedIdentityType] ?? null)
        : null;
    const typeConflict = certTypePrisma !== null && certTypePrisma !== params.newIdentityType;

    if (numberConflict || typeConflict) {
      this.logger.warn(
        {
          companyId: params.companyId,
          activeCertId: activeCert.id,
          certIdSuffix: certId.slice(-4),
          newIdSuffix: newId.slice(-4),
          typeConflict,
        },
        'Company identity change blocked — incompatible with ACTIVE signing certificate',
      );
      // AC-029 / FR-026: Emit audit event for every blocked identity change
      this.audit.record({
        tenantId: params.tenantId,
        companyId: params.companyId,
        action: 'company.identity-change-blocked-by-certificate-conflict',
        eventClass: EventClass.SECURITY,
        metadata: {
          activeCertId: activeCert.id,
          numberConflict,
          typeConflict,
        },
      });
      throw new FiscalCertificateIdentityConflictException();
    }
  }
}
