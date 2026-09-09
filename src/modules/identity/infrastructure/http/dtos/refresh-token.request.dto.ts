import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class RefreshTokenRequestDto {
  @ApiProperty({ description: 'The refresh token received from the login response' })
  @IsString()
  @Length(10, 512)
  refreshToken!: string;
}
