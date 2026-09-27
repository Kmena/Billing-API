import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import {
  SECRET_PROVIDER,
  SecretProvider,
} from '../../../../infrastructure/secrets/ports/secret-provider.port';

/**
 * Hard blockers — any one of these makes readyToIssue = false.
 * Company CANNOT issue documents until all hard blockers are resolved.
 */
export type FiscalReadinessCheckCode =
  // ─── Pre-existing blockers ───────────────────────────────────────────────
  | 'FISCAL_PROFILE_MISSING'
  | 'HACIENDA_CONNECTION_MISSING'
  | 'HACIENDA_CREDENTIALS_MISSING'
  | 'ACTIVE_CERTIFICATE_MISSING'
  | 'CERTIFICATE_EXPIRED'
  | 'CERTIFICATE_NOT_YET_VALID'
  | 'CERTIFICATE_IDENTITY_UNVERIFIED'
  | 'CERTIFICATE_IDENTITY_MISMATCH'
  | 'FISCAL_SIGNING_CERTIFICATE_SECRET_UNAVAILABLE'
  | 'ISSUANCE_POINT_MISSING'
  // ─── P0 blockers — taxpayer & activity ───────────────────────────────────
  | 'TAXPAYER_VALIDATION_MISSING' // Never verified against Hacienda /fe/ae
  | 'TAXPAYER_IDENTITY_MISMATCH' // Verified but identity conflicts Company
  | 'TAXPAYER_NOT_ACTIVE' // Hacienda status is not "Inscrito"
  | 'ECONOMIC_ACTIVITY_MISSING' // No activities persisted at all
  | 'DEFAULT_ECONOMIC_ACTIVITY_MISSING' // No default selected (>1 activities)
  | 'DEFAULT_ECONOMIC_ACTIVITY_INVALID'; // Default is not valid (inactive/disabled/gone)

/**
 * Warnings — informational only.
 * Warnings do NOT make readyToIssue = false in P0 (DEC-003, DEC-004, DEC-005).
 */
export type FiscalReadinessWarningCode =
  | 'TAXPAYER_MOROSO' // moroso = true (DEC-003 — warning only)
  | 'TAXPAYER_OMISO' // omiso = true (DEC-004 — warning only)
  | 'ECONOMIC_ACTIVITY_VERIFICATION_STALE'; // Verification older than 30 days

const STALENESS_DAYS = 30;

export interface FiscalReadinessResult {
  readonly readyToIssue: boolean;
  readonly reasonCodes: FiscalReadinessCheckCode[];
  readonly warnings: FiscalReadinessWarningCode[];
  readonly environment: string;
  readonly companyId: string;
  readonly checkedAt: Date;
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
 * FiscalReadinessService — P0 extended
 *
 * Evaluates whether a company is fully configured to issue fiscal documents.
 * Returns a structured result with boolean readiness, hard-blocker codes, and warnings.
 *
 * Security invariants:
 * - Never returns PIN, PKCS#12, private key, Hacienda password, OAuth token.
 * - Never returns SecretProvider values; only checks safe resolvability.
 * - All queries are tenant-scoped.
 */
@Injectable()
export class FiscalReadinessService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(SECRET_PROVIDER) private readonly secrets: SecretProvider,
  ) {}

  async evaluate(query: CheckFiscalReadinessQuery): Promise<FiscalReadinessResult> {
    const now = new Date();
    const reasons: FiscalReadinessCheckCode[] = [];
    const warnings: FiscalReadinessWarningCode[] = [];

    // ── Check 1: Fiscal profile ─────────────────────────────────────────────
    const fiscalProfile = await this.prisma.companyFiscalProfile.findFirst({
      where: { companyId: query.companyId, tenantId: query.tenantId },
      select: { id: true, defaultEconomicActivityId: true },
    });
    if (!fiscalProfile) {
      reasons.push('FISCAL_PROFILE_MISSING');
    }

    // ── Check 2 & 3: Hacienda connection + credentials ──────────────────────
    const haciendaConnection = await this.prisma.haciendaConnection.findFirst({
      where: {
        companyId: query.companyId,
        tenantId: query.tenantId,
        environment: query.environment as 'PRODUCTION' | 'SANDBOX',
      },
      select: { id: true, status: true },
    });
    if (!haciendaConnection) {
      reasons.push('HACIENDA_CONNECTION_MISSING');
      reasons.push('HACIENDA_CREDENTIALS_MISSING');
    } else if (haciendaConnection.status === 'NOT_CONFIGURED') {
      reasons.push('HACIENDA_CREDENTIALS_MISSING');
    }

    // ── Check 4–6: ACTIVE signing certificate ───────────────────────────────
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
        certificateSecretReference: true,
        passwordSecretReference: true,
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

      const secretsResolvable = await this.canResolveCertificateSecrets(
        activeCert.certificateSecretReference,
        activeCert.passwordSecretReference,
      );
      if (!secretsResolvable) {
        reasons.push('FISCAL_SIGNING_CERTIFICATE_SECRET_UNAVAILABLE');
      }

      if (!activeCert.extractedIdentityNumber) {
        reasons.push('CERTIFICATE_IDENTITY_UNVERIFIED');
      } else {
        const company = await this.prisma.company.findFirst({
          where: { id: query.companyId, tenantId: query.tenantId },
          select: { identificationNumber: true, identificationType: true },
        });
        const certId = activeCert.extractedIdentityNumber.trim().toLowerCase();
        const companyId = (company?.identificationNumber ?? '').trim().toLowerCase();
        const certType = this.certTypeCodeToCompanyType(activeCert.extractedIdentityType);
        const typeMismatch = certType !== null && certType !== company?.identificationType;
        if (certId !== companyId || typeMismatch) {
          reasons.push('CERTIFICATE_IDENTITY_MISMATCH');
        }
      }
    }

    // ── Check 7: Issuance point ──────────────────────────────────────────────
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

    // ── P0 Check 8: Taxpayer verification ────────────────────────────────────
    const company = await this.prisma.company.findFirst({
      where: { id: query.companyId, tenantId: query.tenantId },
      select: {
        haciendaVerificationStatus: true,
        haciendaVerifiedAt: true,
        haciendaTaxSituation: true,
        haciendaMoroso: true,
        haciendaOmiso: true,
      },
    });

    if (!company || !company.haciendaVerificationStatus) {
      reasons.push('TAXPAYER_VALIDATION_MISSING');
    } else if (company.haciendaVerificationStatus !== 'VERIFIED') {
      // NOT_FOUND, UNAVAILABLE, ERROR — all block readiness
      reasons.push('TAXPAYER_VALIDATION_MISSING');
    } else {
      // Verified — check taxpayer status
      if (company.haciendaTaxSituation && company.haciendaTaxSituation !== 'Inscrito') {
        reasons.push('TAXPAYER_NOT_ACTIVE');
      }

      // DEC-003: moroso is a WARNING only
      if (company.haciendaMoroso === true) {
        warnings.push('TAXPAYER_MOROSO');
      }
      // DEC-004: omiso is a WARNING only
      if (company.haciendaOmiso === true) {
        warnings.push('TAXPAYER_OMISO');
      }

      // DEC-005: staleness is a WARNING only
      if (company.haciendaVerifiedAt) {
        const ageMs = now.getTime() - company.haciendaVerifiedAt.getTime();
        const ageDays = ageMs / (1000 * 60 * 60 * 24);
        if (ageDays > STALENESS_DAYS) {
          warnings.push('ECONOMIC_ACTIVITY_VERIFICATION_STALE');
        }
      }
    }

    // ── P0 Check 9: Economic activities ─────────────────────────────────────
    const activities = await this.prisma.companyEconomicActivity.findMany({
      where: { companyId: query.companyId },
    });

    if (activities.length === 0) {
      reasons.push('ECONOMIC_ACTIVITY_MISSING');
      reasons.push('DEFAULT_ECONOMIC_ACTIVITY_MISSING');
    } else if (!fiscalProfile || !fiscalProfile.defaultEconomicActivityId) {
      // No default set — check if we can auto-select
      const validActive = activities.filter((a) => a.haciendaStatus === 'A' && a.billingEnabled);
      if (validActive.length !== 1) {
        // Multiple (or zero) valid activities: explicit selection required
        reasons.push('DEFAULT_ECONOMIC_ACTIVITY_MISSING');
      }
      // If exactly 1 valid: readiness is fine — verification handler auto-selects
      // but until verify is run, we add TAXPAYER_VALIDATION_MISSING above
    } else {
      // Validate the default activity is still valid
      const defaultActivity = activities.find(
        (a) => a.id === fiscalProfile.defaultEconomicActivityId,
      );
      if (!defaultActivity) {
        reasons.push('DEFAULT_ECONOMIC_ACTIVITY_INVALID');
      } else if (defaultActivity.haciendaStatus !== 'A' || !defaultActivity.billingEnabled) {
        reasons.push('DEFAULT_ECONOMIC_ACTIVITY_INVALID');
      }
    }

    return {
      readyToIssue: reasons.length === 0,
      reasonCodes: reasons,
      warnings,
      environment: query.environment,
      companyId: query.companyId,
      checkedAt: now,
      activeCertificate: activeCertMeta,
    };
  }

  private async canResolveCertificateSecrets(certRef: string, pinRef: string): Promise<boolean> {
    const certResolved = await this.canResolveSecret(certRef);
    const pinResolved = await this.canResolveSecret(pinRef);
    return certResolved && pinResolved;
  }

  private async canResolveSecret(ref: string): Promise<boolean> {
    try {
      await this.secrets.getSecret(ref);
      return true;
    } catch {
      return false;
    }
  }

  private certTypeCodeToCompanyType(code: string | null): string | null {
    if (code === '01') return 'FISICA';
    if (code === '02') return 'JURIDICA';
    if (code === '03') return 'DIMEX';
    if (code === '04') return 'NITE';
    return null;
  }
}
