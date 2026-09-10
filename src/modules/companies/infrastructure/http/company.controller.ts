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
import { CreateCompanyHandler } from '../../application/use-cases/create-company/create-company.handler';
import { GetCompanyHandler } from '../../application/use-cases/get-company/get-company.handler';
import { CreateCompanyRequestDto } from './dtos/create-company.request.dto';
import { CompanyResponseDto } from './dtos/company.response.dto';
import type { JwtRequest } from '../../../../api/strategies/jwt.strategy';

@ApiTags('Companies')
@SkipThrottle()
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('companies')
export class CompanyController {
  constructor(
    private readonly createCompanyHandler: CreateCompanyHandler,
    private readonly getCompanyHandler: GetCompanyHandler,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new company for the authenticated tenant' })
  @ApiCreatedResponse({ type: CompanyResponseDto })
  async createCompany(
    @Request() req: { user: JwtRequest },
    @Body() dto: CreateCompanyRequestDto,
  ): Promise<CompanyResponseDto> {
    const result = await this.createCompanyHandler.execute({
      tenantId: req.user.tenantId,
      legalName: dto.legalName,
      tradeName: dto.tradeName,
      identificationType: dto.identificationType,
      identificationNumber: dto.identificationNumber,
    });

    return {
      id: result.id,
      tenantId: result.tenantId,
      legalName: result.legalName,
      tradeName: result.tradeName,
      identificationType: result.identificationType,
      identificationNumber: result.identificationNumber,
      status: result.status,
      haciendaName: result.haciendaName,
      haciendaVerifiedAt: result.haciendaVerifiedAt,
      haciendaVerificationStatus: result.haciendaVerificationStatus,
      createdAt: result.createdAt,
    };
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get a company by ID (tenant-isolated)' })
  @ApiOkResponse({ type: CompanyResponseDto })
  @ApiNotFoundResponse({ description: 'Company not found or does not belong to tenant' })
  async getCompany(@Param('id') id: string): Promise<CompanyResponseDto> {
    const result = await this.getCompanyHandler.execute({ id });

    return {
      id: result.id,
      tenantId: result.tenantId,
      legalName: result.legalName,
      tradeName: result.tradeName,
      identificationType: result.identificationType,
      identificationNumber: result.identificationNumber,
      status: result.status,
      haciendaName: result.haciendaName,
      haciendaVerifiedAt: result.haciendaVerifiedAt,
      haciendaVerificationStatus: result.haciendaVerificationStatus,
      createdAt: result.createdAt,
      updatedAt: result.updatedAt,
    };
  }
}
