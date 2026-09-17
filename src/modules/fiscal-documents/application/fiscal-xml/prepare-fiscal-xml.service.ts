import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import { STORAGE_PORT, StoragePort } from '../../../../infrastructure/storage/ports/storage.port';
import {
  Pkcs12Certificate,
  XML_SIGNER,
  XmlSignerPort,
} from '../../../../infrastructure/signing/ports/xml-signer.port';
import { AuditService, EventClass } from '../../../audit/application/audit.service';
import { FISCAL_XML_SERIALIZER, FiscalXmlSerializerPort } from './fiscal-xml-serializer.port';
import { XSD_VALIDATOR, XsdValidatorPort } from './xsd-validator.port';
import { FiscalSigningCertificateService } from './fiscal-signing-certificate.service';
import { FISCAL_XML_ERROR } from '../../domain/fiscal-xml/fiscal-xml.errors';
import {
  HACIENDA_V44_SCHEMA_VERSION,
  HACIENDA_V44_XADES_CONTRACT,
} from '../../domain/fiscal-xml/hacienda-v44-contract';
import { FiscalXmlProcessingResult } from '../../domain/fiscal-xml/fiscal-xml.types';
import { EnsureInitialFiscalPackageService } from '../delivery/ensure-initial-fiscal-package.service';

@Injectable()
export class PrepareFiscalXmlService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly certificateService: FiscalSigningCertificateService,
    @Inject(FISCAL_XML_SERIALIZER) private readonly serializer: FiscalXmlSerializerPort,
    @Inject(XSD_VALIDATOR) private readonly xsdValidator: XsdValidatorPort,
    @Inject(XML_SIGNER) private readonly signer: XmlSignerPort,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Optional() private readonly ensureInitialDelivery?: EnsureInitialFiscalPackageService,
  ) {}

  async execute(input: {
    tenantId: string;
    documentId: string;
    apiKeyId: string;
    scopes: string[];
    actor?: string;
  }): Promise<FiscalXmlProcessingResult> {
    const document = await this.prisma.fiscalDocument.findFirst({
      where: { id: input.documentId, tenantId: input.tenantId },
      include: { xmlArtifacts: true },
    });
    if (!document) throw new NotFoundException({ code: FISCAL_XML_ERROR.documentNotFound });
    this.assertScope(document.type, input.scopes);
    await this.assertApiKeyCompany(input.apiKeyId, document.companyId);

    const existingArtifact = document.xmlArtifacts[0];
    if (document.status === 'READY_TO_SUBMIT' && existingArtifact?.signedXmlSha256) {
      return this.toResult(document.id, document.status, existingArtifact);
    }
    if (!['READY_FOR_XML', 'XML_GENERATED', 'XML_VALIDATED', 'SIGNED'].includes(document.status)) {
      throw new ConflictException({ code: FISCAL_XML_ERROR.documentNotReady });
    }

    const startedAt = Date.now();
    const artifact = await this.upsertAttemptArtifact(document, existingArtifact?.id);
    try {
      const generated = this.serializer.serialize({
        ...document,
        issuerSnapshot: document.issuerSnapshot as Record<string, unknown>,
        receiverSnapshot: document.receiverSnapshot as Record<string, unknown> | null,
        lines: document.lines,
        totals: document.totals,
      });
      const unsignedXmlBuffer = Buffer.from(generated.xml, 'utf8');
      const unsignedXmlSha256 = this.sha256(unsignedXmlBuffer);
      const unsignedKey = this.storageKey(document, 'unsigned');
      await this.storage.upload(
        unsignedKey,
        unsignedXmlBuffer,
        this.storageMetadata(document, 'unsigned'),
      );
      await this.prisma.$transaction([
        this.prisma.fiscalXmlArtifact.update({
          where: { id: artifact.id },
          data: {
            unsignedXmlStorageKey: unsignedKey,
            unsignedXmlSha256,
            lastErrorCode: null,
            lastErrorMessage: null,
          },
        }),
        this.prisma.fiscalDocument.update({
          where: { id: document.id },
          data: { status: 'XML_GENERATED' },
        }),
      ]);
      this.assertPreSignStructure(generated.xml);
      this.recordAudit(input, document, 'fiscal-xml.generated', {
        artifactHash: unsignedXmlSha256,
        schemaVersion: generated.schemaVersion,
      });

      const certificate = await this.certificateService.getActiveCertificate({
        tenantId: document.tenantId,
        companyId: document.companyId,
        environment: document.environment,
      });
      const signedXml = await this.signer.sign(
        generated.xml,
        this.toPkcs12Certificate(certificate.secret),
      );
      await this.prisma.fiscalDocument.update({
        where: { id: document.id },
        data: { status: 'SIGNED' },
      });
      this.recordAudit(input, document, 'fiscal-xml.signed', {
        certificateId: certificate.id,
        signatureProfile: HACIENDA_V44_XADES_CONTRACT.profile,
      });

      const verification = await this.signer.verify(signedXml);
      if (!verification.isValid) {
        await this.markFailure(
          artifact.id,
          FISCAL_XML_ERROR.signatureVerificationFailed,
          verification.validationErrors[0],
        );
        throw new BadRequestException({ code: FISCAL_XML_ERROR.signatureVerificationFailed });
      }
      this.recordAudit(input, document, 'fiscal-xml.signature-verified', {
        certificateId: certificate.id,
      });

      const signedGenerated = { ...generated, xml: signedXml };
      const validation = this.xsdValidator.validate(signedGenerated);
      if (!validation.isValid) {
        await this.markFailure(
          artifact.id,
          FISCAL_XML_ERROR.xmlValidationFailed,
          validation.errors[0]?.message,
        );
        this.recordAudit(input, document, 'fiscal-xml.validation-failed', {
          normalizedErrorCode: FISCAL_XML_ERROR.xmlValidationFailed,
        });
        throw new BadRequestException({
          code: FISCAL_XML_ERROR.xmlValidationFailed,
          errors: validation.errors,
        });
      }
      const signedBuffer = Buffer.from(signedGenerated.xml, 'utf8');
      const signedXmlSha256 = this.sha256(signedBuffer);
      const signedKey = this.storageKey(document, 'signed');
      await this.storage.upload(signedKey, signedBuffer, this.storageMetadata(document, 'signed'));
      const completed = await this.prisma.$transaction(async (tx) => {
        await tx.fiscalDocument.update({
          where: { id: document.id },
          data: { status: 'XML_VALIDATED' },
        });
        const updatedArtifact = await tx.fiscalXmlArtifact.update({
          where: { id: artifact.id },
          data: {
            signedXmlStorageKey: signedKey,
            signedXmlSha256,
            xsdValidationStatus: 'VALID',
            xsdValidatedAt: new Date(),
            xsdValidationErrors: [],
            signingCertificateId: certificate.id,
            signatureProfile: HACIENDA_V44_XADES_CONTRACT.profile,
            signatureAlgorithm: HACIENDA_V44_XADES_CONTRACT.signatureMethodAlgorithm,
            digestAlgorithm: HACIENDA_V44_XADES_CONTRACT.digestMethodAlgorithm,
            canonicalizationMethod: HACIENDA_V44_XADES_CONTRACT.canonicalizationAlgorithm,
            signedAt: verification.signedAt ?? new Date(),
            signatureVerifiedAt: new Date(),
            lastErrorCode: null,
            lastErrorMessage: null,
          },
        });
        await tx.fiscalDocument.update({
          where: { id: document.id },
          data: { status: 'READY_TO_SUBMIT' },
        });
        return updatedArtifact;
      });
      this.recordAudit(input, document, 'fiscal-xml.validated', {
        artifactHash: signedXmlSha256,
        schemaVersion: validation.schemaVersion,
      });
      this.recordAudit(input, document, 'fiscal-document.ready-to-submit', {
        durationMs: Date.now() - startedAt,
        schemaVersion: HACIENDA_V44_SCHEMA_VERSION,
      });

      // F4 integration hook (DEC-011): trigger INITIAL_DOCUMENT delivery after READY_TO_SUBMIT
      // INVARIANT: Does NOT modify FiscalDocument.status. Delivery is independent.
      if (this.ensureInitialDelivery) {
        setImmediate(async () => {
          try {
            await this.ensureInitialDelivery!.ensure({
              tenantId: document.tenantId,
              companyId: document.companyId,
              fiscalDocumentId: document.id,
            });
          } catch {
            // Hook failure must NOT affect fiscal processing — startup recovery will compensate
          }
        });
      }

      return this.toResult(document.id, 'READY_TO_SUBMIT', completed);
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof ConflictException) throw error;
      const code =
        error instanceof Error && error.message.includes('SIGN')
          ? FISCAL_XML_ERROR.signingFailed
          : FISCAL_XML_ERROR.xmlGenerationFailed;
      await this.markFailure(
        artifact.id,
        code,
        error instanceof Error ? error.message : 'Fiscal XML processing failed.',
      );
      this.recordAudit(input, document, 'fiscal-xml.signing-failed', {
        normalizedErrorCode: code,
      });
      throw new BadRequestException({ code });
    }
  }

  private assertPreSignStructure(unsignedXml: string): void {
    if (unsignedXml.includes('<ds:Signature')) {
      throw new Error('FISCAL_XML_UNSIGNED_PAYLOAD_CONTAINS_SIGNATURE');
    }
  }

  private async upsertAttemptArtifact(
    document: {
      id: string;
      tenantId: string;
      companyId: string;
      environment: string;
      type: string;
    },
    artifactId?: string,
  ) {
    if (artifactId) {
      return this.prisma.fiscalXmlArtifact.update({
        where: { id: artifactId },
        data: { processingAttemptCount: { increment: 1 } },
      });
    }
    return this.prisma.fiscalXmlArtifact.create({
      data: {
        id: randomUUID(),
        tenantId: document.tenantId,
        companyId: document.companyId,
        fiscalDocumentId: document.id,
        environment: document.environment as never,
        documentType: document.type as never,
        schemaVersion: HACIENDA_V44_SCHEMA_VERSION,
        xmlProfileVersion: 'serializer-v1',
        processingAttemptCount: 1,
      },
    });
  }

  private async assertApiKeyCompany(apiKeyId: string, companyId: string): Promise<void> {
    const authorization = await this.prisma.apiKeyCompany.findUnique({
      where: { apiKeyId_companyId: { apiKeyId, companyId } },
    });
    if (!authorization) throw new BadRequestException({ code: 'API_KEY_COMPANY_NOT_AUTHORIZED' });
  }

  private assertScope(type: string, scopes: string[]): void {
    const requiredScope = type === 'INVOICE' ? 'invoices:write' : 'tickets:write';
    if (!scopes.includes(requiredScope))
      throw new BadRequestException({ code: 'INSUFFICIENT_SCOPE' });
  }

  private async markFailure(artifactId: string, code: string, message?: string): Promise<void> {
    await this.prisma.fiscalXmlArtifact.update({
      where: { id: artifactId },
      data: {
        xsdValidationStatus: code === FISCAL_XML_ERROR.xmlValidationFailed ? 'INVALID' : undefined,
        lastErrorCode: code,
        lastErrorMessage: this.sanitize(message ?? code),
      },
    });
  }

  private recordAudit(
    input: { tenantId: string; actor?: string },
    document: { id: string; companyId: string; environment: string; type: string },
    action: string,
    metadata: Record<string, unknown>,
  ): void {
    this.auditService.record({
      tenantId: input.tenantId,
      companyId: document.companyId,
      actor: input.actor,
      action,
      resource: `FiscalDocument:${document.id}`,
      eventClass: EventClass.FISCAL_AUDIT,
      metadata: {
        environment: document.environment,
        documentType: document.type,
        ...metadata,
      },
    });
  }

  private toPkcs12Certificate(secret: {
    pkcs12Base64?: string;
    privateKeyPem?: string;
    certificatePem?: string;
    passphrase?: string;
  }): Pkcs12Certificate {
    return {
      data: secret.pkcs12Base64
        ? Buffer.from(secret.pkcs12Base64, 'base64')
        : Buffer.from(JSON.stringify(secret), 'utf8'),
      passphrase: secret.passphrase ?? '',
    };
  }

  private storageKey(
    document: { tenantId: string; companyId: string; environment: string; id: string },
    kind: 'unsigned' | 'signed',
  ): string {
    return `fiscal/${document.tenantId}/${document.companyId}/${document.environment}/${document.id}/v4.4/${kind}.xml`;
  }

  private storageMetadata(
    document: { tenantId: string; companyId: string; environment: string; id: string },
    kind: string,
  ): Record<string, string> {
    return {
      tenantId: document.tenantId,
      companyId: document.companyId,
      environment: document.environment,
      fiscalDocumentId: document.id,
      artifactKind: kind,
      schemaVersion: HACIENDA_V44_SCHEMA_VERSION,
    };
  }

  private toResult(
    fiscalDocumentId: string,
    status: string,
    artifact: {
      id: string;
      schemaVersion: string;
      unsignedXmlSha256: string | null;
      signedXmlSha256: string | null;
      signedAt: Date | null;
      signatureVerifiedAt: Date | null;
      signingCertificateId: string | null;
    },
  ): FiscalXmlProcessingResult {
    return {
      fiscalDocumentId,
      status,
      artifactId: artifact.id,
      schemaVersion: artifact.schemaVersion,
      unsignedXmlSha256: artifact.unsignedXmlSha256,
      signedXmlSha256: artifact.signedXmlSha256,
      signedAt: artifact.signedAt,
      signatureVerifiedAt: artifact.signatureVerifiedAt,
      certificateId: artifact.signingCertificateId,
    };
  }

  private sha256(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
  }

  private sanitize(message: string): string {
    return message
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/<[^>]+>/g, '<xml omitted>')
      .slice(0, 500);
  }
}
