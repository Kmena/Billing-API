import { Inject, Injectable } from '@nestjs/common';
import { GetCompanyHandler } from '../../../../companies/application/use-cases/get-company/get-company.handler';
import type { HaciendaEnvironment } from '../../../domain/entities/hacienda-connection.entity';
import {
  HACIENDA_CONNECTION_REPOSITORY,
  IHaciendaConnectionRepository,
} from '../../../domain/ports/hacienda-connection.repository';
@Injectable()
export class GetConnectionHandler {
  constructor(
    private readonly company: GetCompanyHandler,
    @Inject(HACIENDA_CONNECTION_REPOSITORY) private readonly repo: IHaciendaConnectionRepository,
  ) {}
  async execute(companyId: string, environment: HaciendaEnvironment) {
    await this.company.execute({ id: companyId });
    return this.repo.findByCompanyAndEnvironment(companyId, environment);
  }
}
