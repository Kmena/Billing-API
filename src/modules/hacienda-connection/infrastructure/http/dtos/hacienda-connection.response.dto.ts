import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
export class HaciendaConnectionResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() tenantId!: string;
  @ApiProperty() companyId!: string;
  @ApiProperty({ enum: ['PRODUCTION', 'SANDBOX'] }) environment!: string;
  @ApiProperty() status!: string;
  @ApiPropertyOptional() lastValidatedAt?: Date;
  @ApiPropertyOptional() lastSuccessfulAuthAt?: Date;
  @ApiPropertyOptional() lastValidationErrorCode?: string;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}
