import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import {
  SECRET_PROVIDER,
  SecretProvider,
} from '../../../../infrastructure/secrets/ports/secret-provider.port';
import { HaciendaTokenCache } from '../../../hacienda-connection/infrastructure/auth/hacienda-token-cache.service';
import type { HaciendaCredentials } from '../../../hacienda-connection/domain/ports/hacienda-auth.port';
import { ConsumerV2Principal } from '../http/consumer-v2.guard';
import { PrismaConsumerV2Repository } from './prisma-consumer-v2.repository';
import { SPEC09_CREDENTIAL_VERIFIER, Spec09CredentialVerifier } from './spec09-credential-verifier';

/** Authenticates stored credentials at the staging IDP without issuing a document. */
@Injectable()
export class OnboardingV2CredentialValidationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: PrismaConsumerV2Repository,
    @Inject(SECRET_PROVIDER) private readonly secrets: SecretProvider,
    @Inject(SPEC09_CREDENTIAL_VERIFIER) private readonly verifier: Spec09CredentialVerifier,
    private readonly tokenCache: HaciendaTokenCache,
  ) {}

  async validate(p: ConsumerV2Principal) {
    if (!this.verifier || p.environment !== 'SANDBOX')
      throw new ConflictException({ code: 'HACIENDA_CREDENTIAL_VALIDATION_DISABLED' });
    const current = await this.prisma.$transaction(async (tx) => {
      await this.repository.assertPrincipalForScope(
        tx,
        p,
        'fiscal-v2:onboarding:credentials:write',
      );
      const found = await tx.haciendaConnection.findFirst({
        where: { tenantId: p.tenantId, companyId: p.companyId, environment: p.environment },
        select: { id: true, secretReference: true, status: true, updatedAt: true },
      });
      if (!found) throw new NotFoundException({ code: 'HACIENDA_CONNECTION_NOT_FOUND' });
      if (found.status === 'DISABLED')
        throw new ConflictException({ code: 'HACIENDA_CONNECTION_DISABLED' });
      return found;
    });
    // No request body, response, audit record or error contains these values.
    let credentials: { username: string; password: string };
    try {
      credentials = JSON.parse(await this.secrets.getSecret(current.secretReference));
    } catch {
      throw new ConflictException({ code: 'HACIENDA_CREDENTIAL_SECRET_INVALID' });
    }
    if (typeof credentials.username !== 'string' || typeof credentials.password !== 'string')
      throw new ConflictException({ code: 'HACIENDA_CREDENTIAL_SECRET_INVALID' });
    let result;
    try {
      result = await this.verifier.validateConnection(
        credentials as HaciendaCredentials,
        'SANDBOX',
      );
    } catch {
      result = { isValid: false, errorCode: 'IDP_UNAVAILABLE' as const };
    } finally {
      credentials.username = '';
      credentials.password = '';
    }
    const status = result.isValid
      ? 'CONNECTED'
      : result.errorCode === 'INVALID_CREDENTIALS'
        ? 'INVALID_CREDENTIALS'
        : 'UNAVAILABLE';
    const at = new Date();
    try {
      const saved = await this.prisma.$transaction(
        async (tx) => {
          await this.repository.assertPrincipalForScope(
            tx,
            p,
            'fiscal-v2:onboarding:credentials:write',
          );
          const updated = await tx.haciendaConnection.updateMany({
            where: {
              id: current.id,
              tenantId: p.tenantId,
              companyId: p.companyId,
              environment: p.environment,
              secretReference: current.secretReference,
              updatedAt: current.updatedAt,
              status: { not: 'DISABLED' },
            },
            data: {
              status,
              lastValidatedAt: at,
              ...(result.isValid ? { lastSuccessfulAuthAt: at } : {}),
              lastValidationErrorCode: result.isValid
                ? null
                : status === 'INVALID_CREDENTIALS'
                  ? 'INVALID_CREDENTIALS'
                  : 'IDP_UNAVAILABLE',
            },
          });
          if (updated.count !== 1)
            throw new ConflictException({ code: 'HACIENDA_CONNECTION_CONCURRENT_CONFLICT' });
          await tx.auditLog.create({
            data: {
              id: randomUUID(),
              tenantId: p.tenantId,
              companyId: p.companyId,
              apiKeyId: p.apiKeyId,
              actor: `apikey:${p.apiKeyId}`,
              action: 'onboarding-v2.credentials.validated',
              eventClass: 'SECURITY',
              metadata: { associationId: p.associationId, environment: p.environment, status },
            },
          });
          return {
            companyId: p.companyId,
            environment: p.environment,
            status,
            lastValidatedAt: at,
            externalCall: true,
            issuedDocument: false,
            productionAuthorized: false,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      this.tokenCache.invalidate(p.companyId, p.environment);
      return saved;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034')
        throw new ConflictException({ code: 'HACIENDA_CONNECTION_CONCURRENT_CONFLICT' });
      throw error;
    }
  }
}
