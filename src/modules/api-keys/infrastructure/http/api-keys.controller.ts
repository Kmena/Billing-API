import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../../../api/guards/jwt-auth.guard';
import { CreateApiKeyHandler } from '../../application/use-cases/create-api-key/create-api-key.handler';
import { ListApiKeysHandler } from '../../application/use-cases/list-api-keys/list-api-keys.handler';
import { RevokeApiKeyHandler } from '../../application/use-cases/revoke-api-key/revoke-api-key.handler';
import { CreateApiKeyRequestDto } from './dtos/create-api-key.request.dto';
import { CreateApiKeyResponseDto, ApiKeyListItemDto } from './dtos/api-key.response.dto';
import type { JwtRequest } from '../../../../api/strategies/jwt.strategy';
import type { ApiKeyEnvironment } from '../../domain/entities/api-key.entity';

@ApiTags('API Keys')
@SkipThrottle()
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api-keys')
export class ApiKeysController {
  constructor(
    private readonly createApiKeyHandler: CreateApiKeyHandler,
    private readonly listApiKeysHandler: ListApiKeysHandler,
    private readonly revokeApiKeyHandler: RevokeApiKeyHandler,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new API key (secret shown only once)' })
  @ApiCreatedResponse({ type: CreateApiKeyResponseDto })
  async createApiKey(
    @Request() req: { user: JwtRequest },
    @Body() dto: CreateApiKeyRequestDto,
  ): Promise<CreateApiKeyResponseDto> {
    const result = await this.createApiKeyHandler.execute({
      tenantId: req.user.tenantId,
      name: dto.name,
      environment: dto.environment as ApiKeyEnvironment,
      scopes: dto.scopes,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
    });

    // BR-001: secret is ONLY included in this 201 response
    return {
      id: result.id,
      name: result.name,
      environment: result.environment,
      keyPrefix: result.keyPrefix,
      secret: result.secret,
      scopes: result.scopes,
      status: result.status,
      expiresAt: result.expiresAt,
      createdAt: result.createdAt,
    };
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List all API keys for the tenant (secret never returned)' })
  @ApiOkResponse({ type: [ApiKeyListItemDto] })
  async listApiKeys(@Request() req: { user: JwtRequest }): Promise<ApiKeyListItemDto[]> {
    const items = await this.listApiKeysHandler.execute({ tenantId: req.user.tenantId });

    // BR-001: keyHash and secret are explicitly EXCLUDED from list responses
    return items.map((item) => ({
      id: item.id,
      name: item.name,
      environment: item.environment,
      keyPrefix: item.keyPrefix,
      scopes: item.scopes,
      status: item.status,
      expiresAt: item.expiresAt,
      lastUsedAt: item.lastUsedAt,
      createdAt: item.createdAt,
    }));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke an API key (idempotent)' })
  @ApiNoContentResponse({ description: 'API key revoked' })
  @ApiUnauthorizedResponse()
  async revokeApiKey(@Request() req: { user: JwtRequest }, @Param('id') id: string): Promise<void> {
    await this.revokeApiKeyHandler.execute({
      id,
      revokedBy: req.user.userId,
    });
  }
}
