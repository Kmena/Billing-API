import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export class FiscalIdentityLookupQueryDto {
  @ApiProperty({ example: 'inventori:1:invoice:1890' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  idempotencyKey!: string;

  @ApiProperty({ enum: ['fiscal-document.create.invoice', 'fiscal-document.create.ticket'] })
  @IsIn(['fiscal-document.create.invoice', 'fiscal-document.create.ticket'])
  operation!: 'fiscal-document.create.invoice' | 'fiscal-document.create.ticket';

  @ApiProperty({ description: 'SHA-256 hash of the original fiscal-create request.' })
  @Matches(/^[a-fA-F0-9]{64}$/)
  requestHash!: string;
}