import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import {
  SECRET_PROVIDER,
  SecretProvider,
} from '../../../../infrastructure/secrets/ports/secret-provider.port';
import { FISCAL_XML_ERROR } from '../../domain/fiscal-xml/fiscal-xml.errors';
import { FiscalSigningCertificateContext } from '../../domain/fiscal-xml/fiscal-xml.types';
import { HaciendaEnvironment } from '../../domain/fiscal.constants';

@Injectable()
export class FiscalSigningCertificateService {
  private readonly logger = new Logger(FiscalSigningCertificateService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SECRET_PROVIDER) private readonly secrets: SecretProvider,
  ) {}

  async getActiveCertificate(input: {
    tenantId: string;
    companyId: string;
    environment: HaciendaEnvironment;
  }): Promise<FiscalSigningCertificateContext> {
    const certificate = await this.prisma.fiscalSigningCertificate.findFirst({
      where: {
        tenantId: input.tenantId,
        companyId: input.companyId,
        environment: input.environment,
      },
      orderBy: [{ activeFrom: 'desc' }, { createdAt: 'desc' }],
    });
    if (!certificate) {
      throw new NotFoundException({ code: FISCAL_XML_ERROR.certificateNotConfigured });
    }
    if (
      certificate.tenantId !== input.tenantId ||
      certificate.companyId !== input.companyId ||
      certificate.environment !== input.environment
    ) {
      throw new BadRequestException({ code: FISCAL_XML_ERROR.certificateScopeMismatch });
    }
    if (certificate.status !== 'ACTIVE') {
      throw new BadRequestException({ code: FISCAL_XML_ERROR.certificateDisabled });
    }
    const now = new Date();
    if (certificate.validFrom && certificate.validFrom > now) {
      throw new BadRequestException({ code: FISCAL_XML_ERROR.certificateDisabled });
    }
    if (certificate.validTo && certificate.validTo <= now) {
      throw new BadRequestException({ code: FISCAL_XML_ERROR.certificateExpired });
    }

    // TASK-004 — Defense-in-depth: re-validate certificate ↔ Company identity
    // before every signing operation.
    //
    // FR-013 requires this check for EVERY signing operation.
    //
    // A NULL extractedIdentityNumber indicates the certificate was registered
    // before the F5 identity-extraction feature (F5-LEGACY-001 — e.g. the F4-S
    // bootstrap record). Such certificates MUST NOT be allowed to sign because
    // their identity has not been verified against the company.
    //
    // Resolution path: operator must re-upload the certificate via
    // POST /companies/:id/fiscal-certificates/:env to populate the identity.
    //
    // This guard protects against: stale configuration, legacy DB changes,
    // manual mutations, migration inconsistencies, and future bugs.
    if (!certificate.extractedIdentityNumber) {
      this.logger.warn(
        {
          companyId: input.companyId,
          environment: input.environment,
          certIdSuffix: certificate.id.slice(-4),
        },
        'Pre-signing identity check: certificate has no extracted identity — blocking signing (F5-LEGACY-001)',
      );
      throw new BadRequestException({ code: FISCAL_XML_ERROR.certificateIdentityUnverified });
    }

    const company = await this.prisma.company.findFirst({
      where: { id: input.companyId, tenantId: input.tenantId },
      select: { identificationNumber: true },
    });
    const certId = certificate.extractedIdentityNumber.trim().toLowerCase();
    const companyId = (company?.identificationNumber ?? '').trim().toLowerCase();
    if (certId !== companyId) {
      this.logger.warn(
        {
          companyId: input.companyId,
          environment: input.environment,
          certIdSuffix: certId.slice(-4),
          companyIdSuffix: companyId.slice(-4),
        },
        'Pre-signing identity check failed: certificate emitter does not match company',
      );
      throw new BadRequestException({ code: FISCAL_XML_ERROR.certificateEmitterMismatch });
    }

    try {
      const [certificateSecret, passphrase] = await Promise.all([
        this.secrets.getSecret(certificate.certificateSecretReference),
        this.secrets.getSecret(certificate.passwordSecretReference),
      ]);
      const secret = this.parseCertificateSecret(certificateSecret, passphrase);
      return {
        id: certificate.id,
        tenantId: certificate.tenantId,
        companyId: certificate.companyId,
        environment: certificate.environment,
        certificateType: certificate.certificateType,
        fingerprintSha256: certificate.fingerprintSha256,
        serialNumber: certificate.serialNumber,
        subjectName: certificate.subjectName,
        issuerName: certificate.issuerName,
        validFrom: certificate.validFrom,
        validTo: certificate.validTo,
        secret,
      };
    } catch {
      throw new BadRequestException({ code: FISCAL_XML_ERROR.certificateInvalidSecret });
    }
  }

  private parseCertificateSecret(certificateSecret: string, passphrase: string) {
    const parsed = JSON.parse(certificateSecret) as {
      pkcs12Base64?: unknown;
      privateKeyPem?: unknown;
      certificatePem?: unknown;
    };
    if (typeof parsed.pkcs12Base64 === 'string') {
      return {
        pkcs12Base64: parsed.pkcs12Base64,
        passphrase,
      };
    }
    if (typeof parsed.privateKeyPem === 'string' && typeof parsed.certificatePem === 'string') {
      return {
        privateKeyPem: parsed.privateKeyPem,
        certificatePem: parsed.certificatePem,
        passphrase,
      };
    }
    throw new Error('FISCAL_SIGNING_CERTIFICATE_SECRET_INCOMPLETE');
  }
}
