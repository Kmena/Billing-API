import { HaciendaConnection } from '../entities/hacienda-connection.entity';
import type { HaciendaEnvironment } from '../entities/hacienda-connection.entity';

export interface IHaciendaConnectionRepository {
  findByCompanyAndEnvironment(
    companyId: string,
    environment: HaciendaEnvironment,
  ): Promise<HaciendaConnection | null>;
  /**
   * Persists a connection and returns false when an existing row changed after
   * it was read. Callers use this optimistic guard to avoid configuration,
   * validation and disable operations silently overwriting one another.
   */
  save(connection: HaciendaConnection, expectedUpdatedAt?: Date): Promise<boolean>;
}
export const HACIENDA_CONNECTION_REPOSITORY = Symbol('HaciendaConnectionRepository');
