import type { HaciendaConnection } from '../../domain/entities/hacienda-connection.entity';
import { HaciendaConnectionResponseDto } from './dtos/hacienda-connection.response.dto';

export function toHaciendaConnectionResponseDto(
  connection: HaciendaConnection,
): HaciendaConnectionResponseDto {
  return {
    id: connection.id,
    tenantId: connection.tenantId,
    companyId: connection.companyId,
    environment: connection.environment,
    status: connection.status,
    lastValidatedAt: connection.lastValidatedAt,
    lastSuccessfulAuthAt: connection.lastSuccessfulAuthAt,
    lastValidationErrorCode: connection.lastValidationErrorCode,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  };
}
