import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../../infrastructure/database/prisma.service';
import { ApiKeyNotFoundException } from '../../../domain/exceptions/api-key-not-found.exception';
import { BILLING_CONSUMER_V2_PROFILE } from '../../../../fiscal-consumers/domain/consumer-v2.policy';

function isUniqueConstraintError(error: unknown): error is { code: 'P2002' } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}
export interface AssignApiKeyCompanyCommand {
  readonly tenantId: string;
  readonly apiKeyId: string;
  readonly companyId: string;
}

export interface AssignApiKeyCompanyResult {
  readonly created: boolean;
}

/**
 * Creates a tenant-scoped authorization link between an active integration key
 * and an active company. It intentionally has no scope-mutation capability.
 */
@Injectable()
export class AssignApiKeyCompanyHandler {
  constructor(private readonly prisma: PrismaService) {}

  async execute(command: AssignApiKeyCompanyCommand): Promise<AssignApiKeyCompanyResult> {
    const apiKey = await this.prisma.apiKey.findFirst({
      where: {
        id: command.apiKeyId,
        tenantId: command.tenantId,
        status: 'ACTIVE',
      },
      select: { id: true, integrationProfile: true },
    });
    if (!apiKey) throw new ApiKeyNotFoundException(command.apiKeyId);
    if (apiKey.integrationProfile === BILLING_CONSUMER_V2_PROFILE) {
      throw new ForbiddenException({ code: 'CONSUMER_V2_KEY_BINDING_ONLY' });
    }

    const company = await this.prisma.company.findFirst({
      where: {
        id: command.companyId,
        tenantId: command.tenantId,
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    if (!company) throw new NotFoundException({ code: 'COMPANY_NOT_FOUND' });

    try {
      await this.prisma.apiKeyCompany.create({
        data: { apiKeyId: apiKey.id, companyId: company.id },
      });
      return { created: true };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return { created: false };
      }
      throw error;
    }
  }
}
