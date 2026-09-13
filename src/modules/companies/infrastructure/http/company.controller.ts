import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
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
import { GetCompanyFiscalProfileHandler } from '../../application/use-cases/get-fiscal-profile/get-company-fiscal-profile.handler';
import { UpsertCompanyFiscalProfileHandler } from '../../application/use-cases/upsert-fiscal-profile/upsert-company-fiscal-profile.handler';
import { CreateCompanyRequestDto } from './dtos/create-company.request.dto';
import { CompanyResponseDto } from './dtos/company.response.dto';
import {
  CompanyFiscalProfileResponseDto,
  UpsertCompanyFiscalProfileRequestDto,
} from './dtos/company-fiscal-profile.dto';
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
    private readonly getCompanyFiscalProfileHandler: GetCompanyFiscalProfileHandler,
    private readonly upsertCompanyFiscalProfileHandler: UpsertCompanyFiscalProfileHandler,
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

  @Put(':id/fiscal-profile')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create or update company fiscal issuer profile (tenant admin only)' })
  @ApiOkResponse({ type: CompanyFiscalProfileResponseDto })
  async upsertFiscalProfile(
    @Request() req: { user: JwtRequest },
    @Param('id') id: string,
    @Body() dto: UpsertCompanyFiscalProfileRequestDto,
  ): Promise<CompanyFiscalProfileResponseDto> {
    return this.upsertCompanyFiscalProfileHandler.execute({
      tenantId: req.user.tenantId,
      companyId: id,
      actor: req.user.userId,
      role: req.user.role,
      economicActivityCode: dto.economicActivityCode,
      proveedorSistemas: dto.proveedorSistemas,
      province: dto.province,
      canton: dto.canton,
      district: dto.district,
      barrio: dto.barrio,
      otrasSenas: dto.otrasSenas,
      email: dto.email,
      phoneCountryCode: dto.phoneCountryCode,
      phoneNumber: dto.phoneNumber,
    });
  }

  @Get(':id/fiscal-profile')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get company fiscal issuer profile (tenant admin only)' })
  @ApiOkResponse({ type: CompanyFiscalProfileResponseDto })
  async getFiscalProfile(
    @Request() req: { user: JwtRequest },
    @Param('id') id: string,
  ): Promise<CompanyFiscalProfileResponseDto> {
    return this.getCompanyFiscalProfileHandler.execute({
      tenantId: req.user.tenantId,
      companyId: id,
      role: req.user.role,
    });
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
