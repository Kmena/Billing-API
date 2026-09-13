import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
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
