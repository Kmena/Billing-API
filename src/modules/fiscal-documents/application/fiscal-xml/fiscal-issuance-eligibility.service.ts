import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import {
  SECRET_PROVIDER,
  SecretProvider,
} from '../../../../infrastructure/secrets/ports/secret-provider.port';
import { HaciendaEnvironment } from '../../domain/fiscal.constants';

export type HaciendaEligibility =
  | {
      readonly eligible: true;
      readonly connectionId: string;
      readonly secretReference: string;
    }
  | {
      readonly eligible: false;
      readonly reason: 'MISSING' | 'NOT_CONNECTED' | 'SECRET_UNAVAILABLE';
    };

/**
 * Single read-only predicate consumed by readiness and fiscal identity creation.
 * It never returns secret values. The connection identity and reference form an
 * internal proof that creation rechecks transactionally before sequence allocation.
 */
@Injectable()
export class FiscalIssuanceEligibilityService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(SECRET_PROVIDER) private readonly secrets: SecretProvider,
  ) {}

  async haciendaEligibility(input: {
    tenantId: string;
    companyId: string;
    environment: HaciendaEnvironment;
  }): Promise<HaciendaEligibility> {
    const connection = await this.prisma.haciendaConnection.findFirst({
      where: {
        tenantId: input.tenantId,
        companyId: input.companyId,
        environment: input.environment,
      },
      select: { id: true, status: true, secretReference: true },
    });
    if (!connection) return { eligible: false, reason: 'MISSING' };
    if (connection.status !== 'CONNECTED') return { eligible: false, reason: 'NOT_CONNECTED' };
    if (!connection.secretReference) return { eligible: false, reason: 'SECRET_UNAVAILABLE' };
    try {
      await this.secrets.getSecret(connection.secretReference);
      return {
        eligible: true,
        connectionId: connection.id,
        secretReference: connection.secretReference,
      };
    } catch {
      return { eligible: false, reason: 'SECRET_UNAVAILABLE' };
    }
  }

  async activeDefaultIssuancePoint(input: {
    tenantId: string;
    companyId: string;
    environment: HaciendaEnvironment;
  }) {
    return this.prisma.fiscalIssuancePoint.findFirst({
      where: {
        tenantId: input.tenantId,
        companyId: input.companyId,
        environment: input.environment,
        active: true,
        isDefault: true,
      },
      orderBy: { id: 'asc' },
    });
  }
}
