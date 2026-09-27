import { Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { GetCompanyHandler } from '../../../../companies/application/use-cases/get-company/get-company.handler';
import { AuditService, EventClass } from '../../../../audit/application/audit.service';
import {
  SECRET_PROVIDER,
  SecretProvider,
} from '../../../../../infrastructure/secrets/ports/secret-provider.port';
import {
  HaciendaConnection,
  HaciendaEnvironment,
} from '../../../domain/entities/hacienda-connection.entity';
import {
  HACIENDA_CONNECTION_REPOSITORY,
  IHaciendaConnectionRepository,
} from '../../../domain/ports/hacienda-connection.repository';
import { HaciendaTokenCache } from '../../../infrastructure/auth/hacienda-token-cache.service';

export interface ConfigureConnectionCommand {
  tenantId: string;
  companyId: string;
  environment: HaciendaEnvironment;
  username?: string;
  password?: string;
  /**
   * Internal recovery path for re-storing a lost durable secret for an already
   * validated connection. Public credential changes must not set this flag.
   */
  preserveConnectedStatusForSecretRestore?: boolean;
}
@Injectable()
export class ConfigureConnectionHandler {
  constructor(
    private readonly company: GetCompanyHandler,
    @Inject(HACIENDA_CONNECTION_REPOSITORY) private readonly repo: IHaciendaConnectionRepository,
    @Inject(SECRET_PROVIDER) private readonly secrets: SecretProvider,
    private readonly cache: HaciendaTokenCache,
    private readonly audit: AuditService,
  ) {}
  async execute(command: ConfigureConnectionCommand): Promise<HaciendaConnection> {
    await this.company.execute({ id: command.companyId });
    const existing = await this.repo.findByCompanyAndEnvironment(
      command.companyId,
      command.environment,
    );
    if (!command.username && !command.password)
      throw new UnprocessableEntityException({
        code: 'HACIENDA_CONNECTION_INSUFFICIENT_CREDENTIALS',
        message: 'Provide username or password.',
      });
    let credentials: { username: string; password: string };
    if (existing) {
      const previous =
        command.username && command.password
          ? undefined
          : JSON.parse(await this.secrets.getSecret(existing.secretReference));
      credentials = {
        username: command.username ?? previous.username,
        password: command.password ?? previous.password,
      };
    } else {
      if (!command.username || !command.password)
        throw new UnprocessableEntityException({
          code: 'HACIENDA_CONNECTION_INSUFFICIENT_CREDENTIALS',
          message: 'Username and password are required when creating a connection.',
        });
      credentials = { username: command.username, password: command.password };
    }
    const reference = `hacienda-conn/${command.companyId}/${command.environment}`;
    await this.secrets.storeSecret(reference, JSON.stringify(credentials));
    const connection = this.buildConnection(command, existing, reference);
    await this.repo.save(connection);
    this.cache.invalidate(command.companyId, command.environment);
    this.audit.record({
      tenantId: command.tenantId,
      companyId: command.companyId,
      action: existing
        ? 'hacienda-connection.credentials-rotated'
        : 'hacienda-connection.configured',
      eventClass: EventClass.SECURITY,
      metadata: { environment: command.environment },
    });
    return connection;
  }

  private buildConnection(
    command: ConfigureConnectionCommand,
    existing: HaciendaConnection | null,
    reference: string,
  ): HaciendaConnection {
    const shouldPreserveConnectedStatus =
      command.preserveConnectedStatusForSecretRestore === true &&
      existing?.status === 'CONNECTED' &&
      Boolean(command.username) &&
      Boolean(command.password);

    if (shouldPreserveConnectedStatus) {
      return HaciendaConnection.reconstruct({
        id: existing.id,
        tenantId: existing.tenantId,
        companyId: existing.companyId,
        environment: existing.environment,
        status: existing.status,
        secretReference: reference,
        lastValidatedAt: existing.lastValidatedAt,
        lastSuccessfulAuthAt: existing.lastSuccessfulAuthAt,
        lastValidationErrorCode: existing.lastValidationErrorCode,
        createdAt: existing.createdAt,
        updatedAt: new Date(),
      });
    }

    return HaciendaConnection.configure(
      existing?.id ?? randomUUID(),
      command.tenantId,
      command.companyId,
      command.environment,
      reference,
      Boolean(existing),
    );
  }
}
