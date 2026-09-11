import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
export class ConfigureConnectionRequestDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  username?: string;
  @ApiPropertyOptional({ maxLength: 200, format: 'password' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  password?: string;
}
