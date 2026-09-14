import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import { FiscalDocumentType, HaciendaEnvironment } from '../../domain/fiscal.constants';
import { FiscalSubmissionResponse } from './fiscal-submission-response';

@Injectable()
export class GetFiscalSubmissionStatusService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(input: {
    readonly tenantId: string;
    readonly companyId: string;
    readonly environment: HaciendaEnvironment;
    readonly documentType: FiscalDocumentType;
    readonly documentId: string;
    readonly apiKeyId: string;
    readonly scopes: string[];
  }): Promise<FiscalSubmissionResponse> {
    this.assertScope(input.documentType, input.scopes);
    await this.assertApiKeyCompany(input.apiKeyId, input.companyId);

    const submission = await this.prisma.fiscalSubmission.findFirst({
      where: {
        fiscalDocumentId: input.documentId,
        tenantId: input.tenantId,
        companyId: input.companyId,
        environment: input.environment,
        documentType: input.documentType,
      },
    });

    if (!submission) {
      throw new NotFoundException({ code: 'FISCAL_SUBMISSION_NOT_FOUND' });
    }

    return {
      documentId: submission.fiscalDocumentId,
      submissionId: submission.id,
      clave: submission.clave,
      environment: submission.environment,
      status: submission.status,
      attemptCount: submission.attemptCount,
      reconciliationAttemptCount: submission.reconciliationAttemptCount,
      nextAttemptAt: submission.nextAttemptAt,
      acceptedAt: submission.acceptedAt,
      rejectedAt: submission.rejectedAt,
      lastNormalizedErrorCode: submission.lastNormalizedErrorCode,
      lastSanitizedErrorMessage: submission.lastSanitizedErrorMessage,
      lastProviderStatus: submission.lastProviderStatus,
      responseSha256: submission.responseSha256,
      responseContentType: submission.responseContentType,
      responseReceivedAt: submission.responseReceivedAt,
    };
  }

  private assertScope(documentType: FiscalDocumentType, scopes: string[]): void {
    const requiredScope = documentType === 'INVOICE' ? 'invoices:write' : 'tickets:write';
    if (!scopes.includes(requiredScope))
      throw new ForbiddenException({ code: 'INSUFFICIENT_SCOPE' });
  }

  private async assertApiKeyCompany(apiKeyId: string, companyId: string): Promise<void> {
    const link = await this.prisma.apiKeyCompany.findUnique({
      where: { apiKeyId_companyId: { apiKeyId, companyId } },
    });
    if (!link) throw new ForbiddenException({ code: 'API_KEY_COMPANY_NOT_ALLOWED' });
  }
}
