import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import {
  AFFILIATIONS_ENROLLMENT_V2_PROFILE,
  hasEnrollmentV2Scopes,
} from '../../domain/consumer-v2.policy';

export interface EnrollmentV2Principal {
  apiKeyId: string;
  tenantId: string;
  companyId: string;
  externalCompanyKey: string;
  environment: 'SANDBOX';
}

/** Pre-authorized, one-company enrollment. An ordinary consumer key cannot enter here. */
@Injectable()
export class EnrollmentV2Guard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      params: Record<string, string>;
      enrollmentV2?: EnrollmentV2Principal;
    }>();
    const raw = request.headers['x-api-key'];
    const match = typeof raw === 'string' && /^bk_test_([a-f\d]{8})_([a-f\d]{32})$/.exec(raw);
    if (!match) throw new HttpException({ code: 'ENROLLMENT_KEY_UNAUTHORIZED' }, 401);
    const key = await this.prisma.apiKey.findUnique({
      where: { keyPrefix: match[1] },
      include: { tenant: true, companies: true },
    });
    let verified = false;
    try {
      verified = Boolean(key && (await argon2.verify(key.keyHash, raw)));
    } catch {
      /* fail closed */
    }
    if (
      !key ||
      !verified ||
      key.status !== 'ACTIVE' ||
      !key.expiresAt ||
      key.expiresAt <= new Date() ||
      key.tenant.status !== 'ACTIVE'
    ) {
      throw new HttpException({ code: 'ENROLLMENT_KEY_UNAUTHORIZED' }, 401);
    }
    const external = /^affiliations-enrollment:(affiliations:[a-f\d-]{36})$/.exec(key.name);
    if (
      key.integrationProfile !== AFFILIATIONS_ENROLLMENT_V2_PROFILE ||
      key.environment !== 'TEST' ||
      key.companies.length !== 1 ||
      key.companies[0].companyId !== request.params.companyId ||
      request.params.environment !== 'SANDBOX' ||
      !external ||
      !hasEnrollmentV2Scopes(key.scopes)
    ) {
      throw new HttpException({ code: 'ENROLLMENT_NOT_AUTHORIZED' }, 403);
    }
    const company = await this.prisma.company.findFirst({
      where: { id: request.params.companyId, tenantId: key.tenantId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!company) throw new HttpException({ code: 'ENROLLMENT_COMPANY_NOT_FOUND' }, 404);
    request.enrollmentV2 = {
      apiKeyId: key.id,
      tenantId: key.tenantId,
      companyId: company.id,
      externalCompanyKey: external[1],
      environment: 'SANDBOX',
    };
    return true;
  }
}
