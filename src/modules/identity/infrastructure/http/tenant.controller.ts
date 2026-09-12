import {
  Body,
  Controller,
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
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../../../api/guards/jwt-auth.guard';
import { CreateTenantHandler } from '../../application/use-cases/create-tenant/create-tenant.handler';
import { GetTenantHandler } from '../../application/use-cases/get-tenant/get-tenant.handler';
import { CreateTenantRequestDto } from './dtos/create-tenant.request.dto';
import { TenantResponseDto } from './dtos/tenant.response.dto';
import type { JwtRequest } from '../../../../api/strategies/jwt.strategy';

@ApiTags('Tenants')
@ApiBearerAuth()
@SkipThrottle()
@UseGuards(JwtAuthGuard)
@Controller('tenants')
export class TenantController {
  constructor(
    private readonly createTenantHandler: CreateTenantHandler,
    private readonly getTenantHandler: GetTenantHandler,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new tenant' })
  @ApiCreatedResponse({ type: TenantResponseDto, description: 'Tenant created successfully' })
  async createTenant(@Body() dto: CreateTenantRequestDto): Promise<TenantResponseDto> {
    const result = await this.createTenantHandler.execute({
      name: dto.name,
      slug: dto.slug,
    });

    return {
      id: result.id,
      name: result.name,
      slug: result.slug,
      status: result.status,
      plan: result.plan,
      createdAt: result.createdAt,
    };
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get a tenant by ID' })
  @ApiOkResponse({ type: TenantResponseDto })
  @ApiNotFoundResponse({ description: 'Tenant not found' })
  async getTenant(
    @Param('id') id: string,
    @Request() req: { user: JwtRequest },
  ): Promise<TenantResponseDto> {
    const result = await this.getTenantHandler.execute({
      id,
      authenticatedTenantId: req.user.tenantId,
    });

    return {
      id: result.id,
      name: result.name,
      slug: result.slug,
      status: result.status,
      plan: result.plan,
      createdAt: result.createdAt,
      updatedAt: result.updatedAt,
    };
  }
}
