import { Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
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
    const connection = HaciendaConnection.configure(
      existing?.id ?? uuidv4(),
      command.tenantId,
      command.companyId,
      command.environment,
      reference,
      Boolean(existing),
    );
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
}
