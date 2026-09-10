import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { LoginHandler } from '../../application/use-cases/login/login.handler';
import { RefreshTokenHandler } from '../../application/use-cases/refresh-token/refresh-token.handler';
import { LoginRequestDto } from './dtos/login.request.dto';
import { RefreshTokenRequestDto } from './dtos/refresh-token.request.dto';
import { AuthTokensResponseDto } from './dtos/auth-tokens.response.dto';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly loginHandler: LoginHandler,
    private readonly refreshTokenHandler: RefreshTokenHandler,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ auth: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: 'Authenticate a user and receive JWT tokens' })
  @ApiOkResponse({ type: AuthTokensResponseDto })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials' })
  async login(@Body() dto: LoginRequestDto): Promise<AuthTokensResponseDto> {
    const result = await this.loginHandler.execute({
      tenantId: dto.tenantId,
      email: dto.email,
      password: dto.password,
    });

    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn,
    };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ auth: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: 'Refresh an access token using a refresh token' })
  @ApiOkResponse({ type: AuthTokensResponseDto })
  @ApiUnauthorizedResponse({ description: 'Invalid or expired refresh token' })
  async refresh(@Body() dto: RefreshTokenRequestDto): Promise<AuthTokensResponseDto> {
    const result = await this.refreshTokenHandler.execute({
      refreshToken: dto.refreshToken,
    });

    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn,
    };
  }
}
