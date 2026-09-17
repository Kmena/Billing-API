/**
 * CompanyPdfSettingsController — F4 branding settings and logo management.
 *
 * F4 — TASK-006
 * Update safe branding settings and upload validated logos.
 * No arbitrary HTML/CSS allowed.
 * Logo validated via magic bytes (not just Content-Type).
 */
import {
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  Put,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { IsBoolean, IsHexColor, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiKeyAuthGuard, ApiKeyRequest } from '../../../../api/guards/api-key-auth.guard';
import { ScopeGuard } from '../../../../api/guards/scope.guard';
import { Scopes } from '../../../../api/decorators/scopes.decorator';
import { CompanyPdfSettingsService } from '../../application/pdf/company-pdf-settings.service';

class UpdatePdfSettingsDto {
  @IsOptional()
  @IsHexColor()
  primaryColor?: string;

  @IsOptional()
  @IsHexColor()
  secondaryColor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  footerText?: string;

  @IsOptional()
  @IsBoolean()
  showCommercialName?: boolean;
}

@ApiTags('Company PDF Settings')
@SkipThrottle()
@UseGuards(ApiKeyAuthGuard, ScopeGuard)
@ApiHeader({ name: 'X-API-Key', required: true })
@Controller('companies/:companyId/pdf-settings')
export class CompanyPdfSettingsController {
  constructor(private readonly pdfSettingsService: CompanyPdfSettingsService) {}

  @Put()
  @Scopes('invoices:write')
  @HttpCode(200)
  async updateSettings(
    @Request() request: ApiKeyRequest,
    @Param('companyId') companyId: string,
    @Body() body: UpdatePdfSettingsDto,
  ) {
    await this.pdfSettingsService.updateSettings({
      tenantId: request.user.tenantId,
      companyId,
      primaryColor: body.primaryColor,
      secondaryColor: body.secondaryColor,
      footerText: body.footerText,
      showCommercialName: body.showCommercialName,
    });
    return { success: true };
  }

  @Post('logo')
  @Scopes('invoices:write')
  @HttpCode(200)
  @UseInterceptors(
    FileInterceptor('logo', {
      limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB max
    }),
  )
  async uploadLogo(
    @Request() request: ApiKeyRequest,
    @Param('companyId') companyId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      return { error: 'No logo file provided.' };
    }

    await this.pdfSettingsService.uploadLogo({
      tenantId: request.user.tenantId,
      companyId,
      logoBytes: file.buffer,
      declaredMimeType: file.mimetype,
    });

    return { success: true };
  }
}
