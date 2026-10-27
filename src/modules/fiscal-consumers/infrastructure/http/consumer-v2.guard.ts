import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as argon2 from 'argon2';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import {
  authorizeConsumerV2,
  ConsumerV2Scope,
  FiscalEnvironmentV2,
} from '../../domain/consumer-v2.policy';
import { CONSUMER_V2_SCOPE_METADATA } from './consumer-v2-scope.decorator';

export interface ConsumerV2Principal {
  tenantId: string;
  consumerId: string;
  associationId: string;
  companyId: string;
  environment: FiscalEnvironmentV2;
  apiKeyId: string;
}

/** Lab-only guard. No controller using it is registered in AppModule. */
@Injectable()
export class ConsumerV2Guard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      params?: Record<string, string | undefined>;
      consumerV2?: ConsumerV2Principal;
      user?: { tenantId: string };
    }>();
    const requiredScope = this.reflector.getAllAndOverride<ConsumerV2Scope>(
      CONSUMER_V2_SCOPE_METADATA,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredScope) throw new HttpException({ code: 'CONSUMER_SCOPE_NOT_CONFIGURED' }, 403);
    const rawKey = request.headers['x-api-key'];
    if (typeof rawKey !== 'string') {
      throw new HttpException({ code: 'CONSUMER_KEY_UNAUTHORIZED' }, 401);
    }
    const match = /^bk_(test|live)_([a-f\d]{8})_([a-f\d]{32})$/.exec(rawKey);
    if (!match) throw new HttpException({ code: 'CONSUMER_KEY_UNAUTHORIZED' }, 401);

    const key = await this.prisma.apiKey.findUnique({
      where: { keyPrefix: match[2] },
      include: { tenant: true },
    });
    let validSecret = false;
    try {
      validSecret = Boolean(key && (await argon2.verify(key.keyHash, rawKey)));
    } catch {
      validSecret = false;
    }
    if (!key || !validSecret) {
      throw new HttpException({ code: 'CONSUMER_KEY_UNAUTHORIZED' }, 401);
    }
    if (match[1] !== (key.environment === 'TEST' ? 'test' : 'live')) {
      throw new HttpException({ code: 'CONSUMER_KEY_UNAUTHORIZED' }, 401);
    }
    const binding = await this.prisma.fiscalConsumerKeyBinding.findUnique({
      where: { apiKeyId: key.id },
      include: {
        association: {
          include: {
            consumerCompany: { include: { consumer: true, company: true } },
          },
        },
      },
    });
    const association = binding?.association;
    const mapping = association?.consumerCompany;
    const companyId = request.params?.companyId;
    const environment = request.params?.environment;
    // Guards run before controller pipes. Reject malformed IDs before Prisma sees them.
    if (
      !companyId ||
      !/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(companyId) ||
      !['SANDBOX', 'PRODUCTION'].includes(environment ?? '')
    ) {
      throw new HttpException({ code: 'CONSUMER_RESOURCE_NOT_FOUND' }, 404);
    }
    const requestedCompany = await this.prisma.company.findUnique({ where: { id: companyId } });
    const decision = authorizeConsumerV2({
      key: {
        id: key.id,
        tenantId: key.tenantId,
        environment: key.environment,
        integrationProfile: key.integrationProfile,
        status: key.status,
        expiresAt: key.expiresAt,
        scopes: key.scopes,
      },
      binding: binding && {
        apiKeyId: binding.apiKeyId,
        tenantId: binding.tenantId,
        associationId: binding.associationId,
      },
      association:
        association && mapping
          ? {
              id: association.id,
              tenantId: association.tenantId,
              consumerId: mapping.consumerId,
              companyId: mapping.companyId,
              environment: association.environment,
              status:
                association.status === 'ACTIVE' && mapping.status === 'ACTIVE'
                  ? 'ACTIVE'
                  : 'SUSPENDED',
            }
          : null,
      consumer: mapping
        ? {
            id: mapping.consumer.id,
            tenantId: mapping.consumer.tenantId,
            status: mapping.consumer.status === 'ACTIVE' ? 'ACTIVE' : 'SUSPENDED',
          }
        : null,
      requestedCompany: requestedCompany && {
        id: requestedCompany.id,
        tenantId: requestedCompany.tenantId,
        status: requestedCompany.status === 'ACTIVE' ? 'ACTIVE' : 'SUSPENDED',
      },
      requestedCompanyId: companyId,
      requestedEnvironment: environment as FiscalEnvironmentV2,
      requiredScope,
      now: new Date(),
      tenantActive: key.tenant.status === 'ACTIVE',
    });
    if (!decision.allowed) throw new HttpException({ code: decision.code }, decision.status);
    request.consumerV2 = decision.principal;
    request.user = { tenantId: decision.principal.tenantId };
    return true;
  }
}
