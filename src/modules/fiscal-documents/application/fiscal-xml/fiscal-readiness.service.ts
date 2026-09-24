import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';

/** Individual reason codes for fiscal readiness check. */
export type FiscalReadinessCheckCode =
  | 'FISCAL_PROFILE_MISSING'
  | 'HACIENDA_CONNECTION_MISSING'
  | 'HACIENDA_CREDENTIALS_MISSING'
  | 'ACTIVE_CERTIFICATE_MISSING'
  | 'CERTIFICATE_EXPIRED'
  | 'CERTIFICATE_NOT_YET_VALID'
  | 'CERTIFICATE_IDENTITY_MISMATCH'
  | 'ISSUANCE_POINT_MISSING';

export interface FiscalReadinessResult {
  /** True only when ALL checks pass and the company can issue fiscal documents. */
  readonly readyToIssue: boolean;
  /**
   * Non-empty when readyToIssue is false.
   * Each code identifies one unsatisfied condition.
   * Never includes certificate bytes, PIN, or private key material.
   */
  readonly reasonCodes: FiscalReadinessCheckCode[];
  /**
   * Environment-specific metadata (safe, no secrets).
   */
  readonly environment: string;
  readonly companyId: string;
  readonly checkedAt: Date;
  /** Safe certificate metadata when an ACTIVE cert is found. Never secrets. */
  readonly activeCertificate?: {
    readonly id: string;
    readonly fingerprintSha256: string | null;
    readonly validFrom: Date | null;
    readonly validTo: Date | null;
    readonly extractedIdentityNumber: string | null;
    readonly extractedIdentityType: string | null;
    readonly subjectName: string | null;
  } | null;
}

export interface CheckFiscalReadinessQuery {
  readonly tenantId: string;
  readonly companyId: string;
  readonly environment: string;
}

/**
 * FiscalReadinessService — TASK-007
 *
 * Evaluates whether a company is fully configured to issue fiscal documents.
 * Returns a structured result with boolean readiness and reason codes.
 *
 * Security invariants:
 * - Never returns PIN, PKCS#12, private key, Hacienda password, OAuth token.
 * - Never calls SecretProvider — all checks are metadata-only.
 * - All queries are tenant-scoped.
 */
@Injectable()
export class FiscalReadinessService {
  constructor(private readonly prisma: PrismaService) {}

  async evaluate(query: CheckFiscalReadinessQuery): Promise<FiscalReadinessResult> {
    const now = new Date();
    const reasons: FiscalReadinessCheckCode[] = [];

    // Check 1: Fiscal profile exists
    const fiscalProfile = await this.prisma.companyFiscalProfile.findFirst({
      where: {
        companyId: query.companyId,
        tenantId: query.tenantId,
      },
      select: { id: true },
    });
    if (!fiscalProfile) {
      reasons.push('FISCAL_PROFILE_MISSING');
    }

    // Check 2 & 3: Hacienda connection + credentials
    // The connection is environment-scoped; credentials are stored via secretReference.
    // NOT_CONFIGURED status means credentials have not yet been supplied.
    const haciendaConnection = await this.prisma.haciendaConnection.findFirst({
      where: {
        companyId: query.companyId,
        tenantId: query.tenantId,
        environment: query.environment as 'PRODUCTION' | 'SANDBOX',
      },
      select: {
        id: true,
        status: true,
        // secretReference is NOT returned (no secrets exposed)
      },
    });
    if (!haciendaConnection) {
      reasons.push('HACIENDA_CONNECTION_MISSING');
      reasons.push('HACIENDA_CREDENTIALS_MISSING');
    } else if (haciendaConnection.status === 'NOT_CONFIGURED') {
      reasons.push('HACIENDA_CREDENTIALS_MISSING');
    }

    // Check 4-6: ACTIVE signing certificate
    const activeCert = await this.prisma.fiscalSigningCertificate.findFirst({
      where: {
        tenantId: query.tenantId,
        companyId: query.companyId,
        environment: query.environment as 'PRODUCTION' | 'SANDBOX',
        status: 'ACTIVE',
      },
      select: {
        id: true,
        fingerprintSha256: true,
        validFrom: true,
        validTo: true,
        extractedIdentityNumber: true,
        extractedIdentityType: true,
        subjectName: true,
        // certificateSecretReference and passwordSecretReference are NOT selected
      },
      orderBy: [{ activeFrom: 'desc' }, { createdAt: 'desc' }],
    });

    let activeCertMeta: FiscalReadinessResult['activeCertificate'] = null;

    if (!activeCert) {
      reasons.push('ACTIVE_CERTIFICATE_MISSING');
    } else {
      activeCertMeta = {
        id: activeCert.id,
        fingerprintSha256: activeCert.fingerprintSha256,
        validFrom: activeCert.validFrom,
        validTo: activeCert.validTo,
        extractedIdentityNumber: activeCert.extractedIdentityNumber,
        extractedIdentityType: activeCert.extractedIdentityType,
        subjectName: activeCert.subjectName,
      };

      if (activeCert.validTo && activeCert.validTo <= now) {
        reasons.push('CERTIFICATE_EXPIRED');
      } else if (activeCert.validFrom && activeCert.validFrom > now) {
        reasons.push('CERTIFICATE_NOT_YET_VALID');
      }

      // Check 6: Certificate ↔ company identity match
      if (activeCert.extractedIdentityNumber) {
        const company = await this.prisma.company.findFirst({
          where: { id: query.companyId, tenantId: query.tenantId },
          select: { identificationNumber: true },
        });
        const certId = activeCert.extractedIdentityNumber.trim().toLowerCase();
        const companyId = (company?.identificationNumber ?? '').trim().toLowerCase();
        if (certId !== companyId) {
          reasons.push('CERTIFICATE_IDENTITY_MISMATCH');
        }
      }
    }

    // Check 7: Issuance point exists for this environment
    const issuancePoint = await this.prisma.fiscalIssuancePoint.findFirst({
      where: {
        tenantId: query.tenantId,
        companyId: query.companyId,
        environment: query.environment as 'PRODUCTION' | 'SANDBOX',
      },
      select: { id: true },
    });
    if (!issuancePoint) {
      reasons.push('ISSUANCE_POINT_MISSING');
    }

    return {
      readyToIssue: reasons.length === 0,
      reasonCodes: reasons,
      environment: query.environment,
      companyId: query.companyId,
      checkedAt: now,
      activeCertificate: activeCertMeta,
    };
  }
}
