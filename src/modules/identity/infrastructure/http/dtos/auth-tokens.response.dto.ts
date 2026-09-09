import { ApiProperty } from '@nestjs/swagger';

export class AuthTokensResponseDto {
  @ApiProperty({ description: 'JWT access token (valid for 15 minutes)' })
  accessToken!: string;

  @ApiProperty({ description: 'Refresh token (valid for 7 days, rotated on each use)' })
  refreshToken!: string;

  @ApiProperty({ description: 'Access token expiry in seconds', example: 900 })
  expiresIn!: number;
}
