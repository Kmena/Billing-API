import { HaciendaConnection } from '../entities/hacienda-connection.entity';
import type { HaciendaEnvironment } from '../entities/hacienda-connection.entity';

export interface IHaciendaConnectionRepository {
  findByCompanyAndEnvironment(
    companyId: string,
    environment: HaciendaEnvironment,
  ): Promise<HaciendaConnection | null>;
  save(connection: HaciendaConnection): Promise<void>;
}
export const HACIENDA_CONNECTION_REPOSITORY = Symbol('HaciendaConnectionRepository');
