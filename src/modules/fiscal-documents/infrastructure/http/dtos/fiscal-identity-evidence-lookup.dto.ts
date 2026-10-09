import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString, MaxLength, ValidateNested } from 'class-validator';
import { CreateFiscalDocumentDto } from './fiscal-document.dtos';

export class FiscalIdentityEvidencePayloadDto extends CreateFiscalDocumentDto {}

export class FiscalIdentityEvidenceLookupDto {
  @ApiProperty({ example: 'inventori:1:invoice:1890' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  idempotencyKey!: string;

  @ApiProperty({ enum: ['fiscal-document.create.invoice', 'fiscal-document.create.ticket'] })
  @IsIn(['fiscal-document.create.invoice', 'fiscal-document.create.ticket'])
  operation!: 'fiscal-document.create.invoice' | 'fiscal-document.create.ticket';

  @ApiProperty({ example: 'fiscal-payload-equivalence.v1' })
  @IsIn(['fiscal-payload-equivalence.v1'])
  equivalenceContractVersion!: 'fiscal-payload-equivalence.v1';

  @ApiProperty({ type: FiscalIdentityEvidencePayloadDto })
  @ValidateNested()
  @Type(() => FiscalIdentityEvidencePayloadDto)
  fiscalPayload!: FiscalIdentityEvidencePayloadDto;
}