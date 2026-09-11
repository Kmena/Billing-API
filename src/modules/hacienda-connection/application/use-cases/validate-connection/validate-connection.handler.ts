import {
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { GetCompanyHandler } from '../../../../companies/application/use-cases/get-company/get-company.handler';
import { AuditService, EventClass } from '../../../../audit/application/audit.service';
import {
  SECRET_PROVIDER,
  SecretProvider,
} from '../../../../../infrastructure/secrets/ports/secret-provider.port';
import type { HaciendaEnvironment } from '../../../domain/entities/hacienda-connection.entity';
import { HACIENDA_AUTH_PORT, HaciendaAuthPort } from '../../../domain/ports/hacienda-auth.port';
import {
  HACIENDA_CONNECTION_REPOSITORY,
  IHaciendaConnectionRepository,
} from '../../../domain/ports/hacienda-connection.repository';
import { HaciendaTokenCache } from '../../../infrastructure/auth/hacienda-token-cache.service';
@Injectable()
export class ValidateConnectionHandler {
  constructor(
    private readonly company: GetCompanyHandler,
    @Inject(HACIENDA_CONNECTION_REPOSITORY) private readonly repo: IHaciendaConnectionRepository,
    @Inject(SECRET_PROVIDER) private readonly secrets: SecretProvider,
    @Inject(HACIENDA_AUTH_PORT) private readonly auth: HaciendaAuthPort,
    private readonly cache: HaciendaTokenCache,
    private readonly audit: AuditService,
  ) {}
  async execute(tenantId: string, companyId: string, environment: HaciendaEnvironment) {
    await this.company.execute({ id: companyId });
    const c = await this.repo.findByCompanyAndEnvironment(companyId, environment);
    if (!c) throw new NotFoundException({ code: 'HACIENDA_CONNECTION_NOT_FOUND' });
    if (c.status === 'DISABLED')
      throw new UnprocessableEntityException({ code: 'HACIENDA_CONNECTION_DISABLED' });
    const result = await this.auth.validateConnection(
      JSON.parse(await this.secrets.getSecret(c.secretReference)),
      environment,
    );
    const now = new Date();
    if (result.isValid && result.token) {
      c.markConnected(now);
      this.cache.setToken(companyId, environment, result.token);
    } else if (result.errorCode === 'INVALID_CREDENTIALS')
      c.markInvalidCredentials('INVALID_CREDENTIALS', now);
    else c.markUnavailable(result.errorCode ?? 'IDP_UNAVAILABLE', now);
    await this.repo.save(c);
    this.audit.record({
      tenantId,
      companyId,
      action: result.isValid
        ? 'hacienda-connection.validation-succeeded'
        : 'hacienda-connection.validation-failed',
      eventClass: EventClass.SECURITY,
      metadata: { environment, errorCode: result.errorCode },
    });
    return c;
  }
}
