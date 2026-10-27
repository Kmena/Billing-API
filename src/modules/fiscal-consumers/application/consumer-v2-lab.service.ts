import { BadRequestException, Injectable } from '@nestjs/common';
import {
  CONSUMER_V2_W1_SCOPES,
  ConsumerV2Scope,
  FiscalEnvironmentV2,
  hasOnlyW1ConsumerScopes,
} from '../domain/consumer-v2.policy';
import { ConsumerV2Operation } from '../domain/consumer-v2-idempotency.policy';
import { ConsumerV2Principal } from '../infrastructure/http/consumer-v2.guard';
import { PrismaConsumerV2Repository } from '../infrastructure/persistence/prisma-consumer-v2.repository';

export interface RegisterConsumerAssociationV2 {
  tenantId: string;
  companyId: string;
  provider: string;
  externalConsumerKey: string;
  externalCompanyKey: string;
  environment: FiscalEnvironmentV2;
  actorId: string;
  correlationId: string;
}

export interface IssueConsumerKeyV2 {
  tenantId: string;
  associationId: string;
  scopes: ConsumerV2Scope[];
  expiresAt: Date;
  rotationEndsAt?: Date;
  actorId: string;
  correlationId: string;
}

export interface RevokeConsumerKeyV2 {
  tenantId: string;
  associationId: string;
  apiKeyId: string;
  actorId: string;
  correlationId: string;
}

export interface ConsumerV2OperationCommand {
  principal: ConsumerV2Principal;
  operation: ConsumerV2Operation;
  idempotencyKey: string;
  requestHashVersion: string;
  requestHash: string;
  correlationId: string;
}

/** Lab façade. Deliberately absent from AppModule and all production controllers. */
@Injectable()
export class ConsumerV2LabService {
  constructor(private readonly repository: PrismaConsumerV2Repository) {}

  registerAssociation(command: RegisterConsumerAssociationV2) {
    if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(command.provider)) {
      throw new BadRequestException({ code: 'CONSUMER_PROVIDER_INVALID' });
    }
    for (const value of [command.externalConsumerKey, command.externalCompanyKey]) {
      if (!value || value.length > 128 || value.trim() !== value) {
        throw new BadRequestException({ code: 'CONSUMER_EXTERNAL_KEY_INVALID' });
      }
    }
    if (!['SANDBOX', 'PRODUCTION'].includes(command.environment)) {
      throw new BadRequestException({ code: 'CONSUMER_ENVIRONMENT_INVALID' });
    }
    return this.repository.registerAssociation(command);
  }

  issueKey(command: IssueConsumerKeyV2) {
    if (!hasOnlyW1ConsumerScopes(command.scopes)) {
      throw new BadRequestException({ code: 'CONSUMER_SCOPE_INVALID' });
    }
    if (
      !Number.isFinite(command.expiresAt.getTime()) ||
      command.expiresAt <= new Date() ||
      (command.rotationEndsAt &&
        (!Number.isFinite(command.rotationEndsAt.getTime()) ||
          command.rotationEndsAt >= command.expiresAt))
    ) {
      throw new BadRequestException({ code: 'CONSUMER_KEY_EXPIRY_INVALID' });
    }
    return this.repository.issueKey(command);
  }

  revokeKey(command: RevokeConsumerKeyV2) {
    return this.repository.revokeKey(command);
  }

  /** Synthetic-only reservation; no fiscal payload, document or consecutive is created. */
  reserveSyntheticLab(command: ConsumerV2OperationCommand) {
    this.validateOperation(command);
    return this.repository.reserveSyntheticLab(command);
  }

  lookupOperation(command: ConsumerV2OperationCommand) {
    this.validateOperation(command);
    return this.repository.lookupOperation(command);
  }

  findOwnedDocument(principal: ConsumerV2Principal, documentId: string) {
    return this.repository.findOwnedDocument(principal, documentId);
  }

  private validateOperation(command: ConsumerV2OperationCommand): void {
    if (
      command.operation !== 'CREATE_INVOICE' ||
      !command.idempotencyKey ||
      command.idempotencyKey.length > 128 ||
      command.idempotencyKey.trim() !== command.idempotencyKey ||
      !/^[a-z][a-z\d.-]*$/.test(command.requestHashVersion) ||
      command.requestHashVersion.length > 80 ||
      !/^[a-f\d]{64}$/i.test(command.requestHash)
    ) {
      throw new BadRequestException({ code: 'CONSUMER_OPERATION_INVALID' });
    }
  }
}

export { CONSUMER_V2_W1_SCOPES };
