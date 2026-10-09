import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class AssignApiKeyCompanyRequestDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Active company belonging to the authenticated tenant.',
  })
  @IsUUID()
  companyId!: string;
}
