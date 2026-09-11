import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { GetCompanyHandler } from '../../../../companies/application/use-cases/get-company/get-company.handler';
import { AuditService, EventClass } from '../../../../audit/application/audit.service';
import type { HaciendaEnvironment } from '../../../domain/entities/hacienda-connection.entity';
import {
  HACIENDA_CONNECTION_REPOSITORY,
  IHaciendaConnectionRepository,
} from '../../../domain/ports/hacienda-connection.repository';
import { HaciendaTokenCache } from '../../../infrastructure/auth/hacienda-token-cache.service';
@Injectable()
export class DisableConnectionHandler {
  constructor(
    private readonly company: GetCompanyHandler,
    @Inject(HACIENDA_CONNECTION_REPOSITORY) private readonly repo: IHaciendaConnectionRepository,
    private readonly cache: HaciendaTokenCache,
    private readonly audit: AuditService,
  ) {}
  async execute(tenantId: string, companyId: string, environment: HaciendaEnvironment) {
    await this.company.execute({ id: companyId });
    const c = await this.repo.findByCompanyAndEnvironment(companyId, environment);
    if (!c) throw new NotFoundException({ code: 'HACIENDA_CONNECTION_NOT_FOUND' });
    c.disable();
    await this.repo.save(c);
    this.cache.invalidate(companyId, environment);
    this.audit.record({
      tenantId,
      companyId,
      action: 'hacienda-connection.disabled',
      eventClass: EventClass.SECURITY,
      metadata: { environment },
    });
    return c;
  }
}
