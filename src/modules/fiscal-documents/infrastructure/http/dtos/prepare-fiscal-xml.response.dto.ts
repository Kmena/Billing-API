import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PrepareFiscalXmlResponseDto {
  @ApiProperty() fiscalDocumentId!: string;
  @ApiProperty() status!: string;
  @ApiProperty() artifactId!: string;
  @ApiProperty() schemaVersion!: string;
  @ApiPropertyOptional() unsignedXmlSha256?: string | null;
  @ApiPropertyOptional() signedXmlSha256?: string | null;
  @ApiPropertyOptional() signedAt?: Date | null;
  @ApiPropertyOptional() signatureVerifiedAt?: Date | null;
  @ApiPropertyOptional() certificateId?: string | null;
}
