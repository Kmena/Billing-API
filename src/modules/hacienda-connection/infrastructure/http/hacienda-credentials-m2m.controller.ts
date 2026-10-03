import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  Post,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyAuthGuard, type ApiKeyRequest } from '../../../../api/guards/api-key-auth.guard';
import { ApiKeyThrottlerGuard } from '../../../../api/guards/api-key-throttler.guard';
import { ScopeGuard } from '../../../../api/guards/scope.guard';
import { Scopes } from '../../../../api/decorators/scopes.decorator';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import { GetCompanyHandler } from '../../../companies/application/use-cases/get-company/get-company.handler';
import type { HaciendaEnvironment } from '../../domain/entities/hacienda-connection.entity';
import { ConfigureConnectionHandler } from '../../application/use-cases/configure-connection/configure-connection.handler';
import { ValidateConnectionHandler } from '../../application/use-cases/validate-connection/validate-connection.handler';
import { ConfigureConnectionRequestDto } from './dtos/configure-connection.request.dto';
import { HaciendaConnectionResponseDto } from './dtos/hacienda-connection.response.dto';
import { toHaciendaConnectionResponseDto } from './hacienda-connection-response.mapper';

const environments = { PRODUCTION: 'PRODUCTION', SANDBOX: 'SANDBOX' } as const;
const WRITE_SCOPE = 'fiscal-credentials:write';
const VALIDATE_SCOPE = 'fiscal-credentials:validate';

@ApiTags('Fiscal Onboarding (M2M)')
@ApiSecurity('X-API-Key')
@UseGuards(ApiKeyAuthGuard, ApiKeyThrottlerGuard, ScopeGuard)
@Controller('companies/:companyId/fiscal-onboarding/:environment/hacienda-credentials')
export class HaciendaCredentialsM2MController {
  constructor(
    private readonly getCompany: GetCompanyHandler,
    private readonly prisma: PrismaService,
    private readonly configure: ConfigureConnectionHandler,
    private readonly validate: ValidateConnectionHandler,
  ) {}

  @Put()
  @HttpCode(HttpStatus.OK)
  @Scopes(WRITE_SCOPE)
  @ApiOperation({ summary: 'Configure Hacienda credentials (Inventori M2M)' })
  @ApiOkResponse({ type: HaciendaConnectionResponseDto })
  async configureCredentials(
    @Request() req: ApiKeyRequest,
    @Param('companyId') companyId: string,
    @Param('environment', new ParseEnumPipe(environments)) environment: HaciendaEnvironment,
    @Body() body: ConfigureConnectionRequestDto,
  ): Promise<HaciendaConnectionResponseDto> {
    await this.assertApiKeyCompanyAccess(req, companyId);
    const connection = await this.configure.execute({
      tenantId: req.user.tenantId,
      companyId,
      environment,
      username: body.username,
      password: body.password,
    });
    return toHaciendaConnectionResponseDto(connection);
  }

  @Post('validate')
  @HttpCode(HttpStatus.OK)
  @Scopes(VALIDATE_SCOPE)
  @ApiOperation({ summary: 'Validate Hacienda credentials (Inventori M2M)' })
  @ApiOkResponse({ type: HaciendaConnectionResponseDto })
  async validateCredentials(
    @Request() req: ApiKeyRequest,
    @Param('companyId') companyId: string,
    @Param('environment', new ParseEnumPipe(environments)) environment: HaciendaEnvironment,
  ): Promise<HaciendaConnectionResponseDto> {
    await this.assertApiKeyCompanyAccess(req, companyId);
    const connection = await this.validate.execute(req.user.tenantId, companyId, environment);
    return toHaciendaConnectionResponseDto(connection);
  }

  private async assertApiKeyCompanyAccess(req: ApiKeyRequest, companyId: string): Promise<void> {
    // Non-enumerating tenant isolation: GetCompanyHandler returns not-found when the
    // route company is unknown or belongs to another tenant in the active TenantContext.
    await this.getCompany.execute({ id: companyId });

    const authorization = await this.prisma.apiKeyCompany.findUnique({
      where: { apiKeyId_companyId: { apiKeyId: req.apiKey.id, companyId } },
    });

    if (!authorization) {
      throw new ForbiddenException({
        code: 'API_KEY_COMPANY_NOT_AUTHORIZED',
        message: 'API key is not authorized for this company.',
      });
    }
  }
}
