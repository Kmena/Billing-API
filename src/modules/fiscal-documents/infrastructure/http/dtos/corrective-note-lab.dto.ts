import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CreateFiscalLineDto } from './fiscal-document.dtos';

export class CreateCorrectiveNoteLabDto {
  @ApiProperty() @IsUUID() sourceDocumentId!: string;
  @ApiProperty() @Matches(/^\d{2}$/) referenceCode!: string;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(180) reason!: string;
  @ApiPropertyOptional({ type: [CreateFiscalLineDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateFiscalLineDto)
  lines?: CreateFiscalLineDto[];
}
