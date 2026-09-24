import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import { FiscalCertificateNotFoundForReadException } from '../../domain/fiscal-xml/exceptions/fiscal-certificate.exceptions';
import { UploadFiscalSigningCertificateResult } from './upload-fiscal-signing-certificate.service';

export interface ReadCertificateMetadataQuery {
  readonly tenantId: string;
  readonly companyId: string;
  readonly environment: string;
}

/**
 * FiscalReadCertificateMetadataService — TASK-008
 *
 * Returns the current ACTIVE certificate's safe metadata for a company.
 * Never loads secrets from SecretProvider.
 * Never exposes certificateSecretReference or passwordSecretReference.
 */
@Injectable()
export class FiscalReadCertificateMetadataService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(
    query: ReadCertificateMetadataQuery,
  ): Promise<UploadFiscalSigningCertificateResult> {
    const cert = await this.prisma.fiscalSigningCertificate.findFirst({
      where: {
        tenantId: query.tenantId,
        companyId: query.companyId,
        environment: query.environment as 'PRODUCTION' | 'SANDBOX',
        status: 'ACTIVE',
      },
      orderBy: [{ activeFrom: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        companyId: true,
        environment: true,
        status: true,
        fingerprintSha256: true,
        serialNumber: true,
        subjectName: true,
        issuerName: true,
        validFrom: true,
        validTo: true,
        extractedIdentityNumber: true,
        extractedIdentityType: true,
        activeFrom: true,
        createdAt: true,
        updatedAt: true,
        // certificateSecretReference and passwordSecretReference are NOT selected
      },
    });

    if (!cert) {
      throw new FiscalCertificateNotFoundForReadException();
    }

    return {
      id: cert.id,
      companyId: cert.companyId,
      environment: cert.environment,
      status: cert.status,
      fingerprintSha256: cert.fingerprintSha256,
      serialNumber: cert.serialNumber,
      subjectName: cert.subjectName,
      issuerName: cert.issuerName,
      validFrom: cert.validFrom,
      validTo: cert.validTo,
      extractedIdentityNumber: cert.extractedIdentityNumber,
      extractedIdentityType: cert.extractedIdentityType,
      activeFrom: cert.activeFrom,
      createdAt: cert.createdAt,
      updatedAt: cert.updatedAt,
    };
  }
}
