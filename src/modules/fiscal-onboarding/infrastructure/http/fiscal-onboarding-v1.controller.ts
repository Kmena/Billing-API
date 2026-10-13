import {
  Body,
  BadRequestException,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  ParseEnumPipe,
  Patch,
  Post,
  Put,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiSecurity, ApiTags } from '@nestjs/swagger';
import multer = require('multer');
import { JwtAuthGuard } from '../../../../api/guards/jwt-auth.guard';
import { TenantAdminGuard } from '../../../../api/guards/tenant-admin.guard';
import { ApiKeyAuthGuard, type ApiKeyRequest } from '../../../../api/guards/api-key-auth.guard';
import { ApiKeyThrottlerGuard } from '../../../../api/guards/api-key-throttler.guard';
import { ScopeGuard } from '../../../../api/guards/scope.guard';
import { Scopes } from '../../../../api/decorators/scopes.decorator';
import type { JwtRequest } from '../../../../api/strategies/jwt.strategy';
import { UpdateCompanyHandler } from '../../../companies/application/use-cases/update-company/update-company.handler';
import { GetCompanyFiscalProfileHandler } from '../../../companies/application/use-cases/get-fiscal-profile/get-company-fiscal-profile.handler';
import { UpsertCompanyFiscalProfileHandler } from '../../../companies/application/use-cases/upsert-fiscal-profile/upsert-company-fiscal-profile.handler';
import { VerifyCompanyTaxpayerHandler } from '../../../companies/application/use-cases/verify-taxpayer/verify-company-taxpayer.handler';
import { ListEconomicActivitiesHandler } from '../../../companies/application/use-cases/list-economic-activities/list-economic-activities.handler';
import { SetActivityBillingEnabledHandler } from '../../../companies/application/use-cases/set-activity-enabled/set-activity-billing-enabled.handler';
import { SetDefaultEconomicActivityHandler } from '../../../companies/application/use-cases/set-default-activity/set-default-economic-activity.handler';
import { ConfigureConnectionHandler } from '../../../hacienda-connection/application/use-cases/configure-connection/configure-connection.handler';
import { GetConnectionHandler } from '../../../hacienda-connection/application/use-cases/get-connection/get-connection.handler';
import { ValidateConnectionHandler } from '../../../hacienda-connection/application/use-cases/validate-connection/validate-connection.handler';
import { DisableConnectionHandler } from '../../../hacienda-connection/application/use-cases/disable-connection/disable-connection.handler';
import { toHaciendaConnectionResponseDto } from '../../../hacienda-connection/infrastructure/http/hacienda-connection-response.mapper';
import { UploadFiscalSigningCertificateService } from '../../../fiscal-documents/application/fiscal-xml/upload-fiscal-signing-certificate.service';
import { FiscalReadCertificateMetadataService } from '../../../fiscal-documents/application/fiscal-xml/fiscal-read-certificate-metadata.service';
import { IntegrationProfileGuard } from '../integration-profile.guard';
import { BootstrapIntegrationProfileGuard } from '../bootstrap-integration-profile.guard';
import { FiscalOnboardingV1Service } from '../../application/fiscal-onboarding-v1.service';
import { FiscalTestInvoiceV1Service } from '../../application/fiscal-test-invoice-v1.service';
import {
  BootstrapFiscalIssuerDto,
  ConfigureHaciendaCredentialsV1Dto,
  DisableHaciendaConnectionV1Dto,
  ConfigureInitialSequenceV1Dto,
  CreateFiscalBranchDto,
  CreateFiscalTerminalDto,
  FiscalOnboardingDocumentTypeDto,
  FiscalOnboardingEnvironmentDto,
  FiscalTestInvoiceV1Dto,
  ProvisionFiscalIssuerDto,
  SelectDefaultIssuancePointDto,
  SetActivityEnabledV1Dto,
  SetDefaultActivityV1Dto,
  SetFiscalResourceActiveDto,
  UpdateFiscalIssuerDto,
  UpsertFiscalProfileV1Dto,
} from './fiscal-onboarding-v1.dto';

const CERTIFICATE_LIMIT = 1_048_576;

@ApiTags('Fiscal Onboarding v1 — Bootstrap')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantAdminGuard)
@Controller('fiscal-onboarding/v1/associations')
export class FiscalOnboardingBootstrapV1Controller {
  constructor(private readonly onboarding: FiscalOnboardingV1Service) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  provision(@Request() request: { user: JwtRequest }, @Body() dto: ProvisionFiscalIssuerDto) {
    return this.onboarding.provisionAssociation({
      tenantId: request.user.tenantId,
      actor: request.user.userId,
      dto,
    });
  }
}

@ApiTags('Fiscal Onboarding v1 — Service bootstrap')
@ApiSecurity('X-API-Key')
@UseGuards(ApiKeyAuthGuard, ApiKeyThrottlerGuard, BootstrapIntegrationProfileGuard, ScopeGuard)
@Controller('fiscal-onboarding/v1/bootstrap')
export class FiscalOnboardingServiceBootstrapV1Controller {
  constructor(private readonly onboarding: FiscalOnboardingV1Service) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @Scopes('fiscal-bootstrap:provision')
  provision(@Request() request: ApiKeyRequest, @Body() dto: BootstrapFiscalIssuerDto) {
    return this.onboarding.bootstrapAssociation({
      tenantId: request.user.tenantId,
      bootstrapKeyId: request.apiKey.id,
      actor: `apikey:${request.apiKey.keyPrefix}`,
      dto,
    });
  }
}

@ApiTags('Fiscal Onboarding v1 — M2M')
@ApiSecurity('X-API-Key')
@UseGuards(ApiKeyAuthGuard, ApiKeyThrottlerGuard, IntegrationProfileGuard, ScopeGuard)
@Controller('companies/:companyId/fiscal-onboarding/v1/:environment')
export class FiscalOnboardingM2MV1Controller {
  constructor(
    private readonly onboarding: FiscalOnboardingV1Service,
    private readonly testInvoices: FiscalTestInvoiceV1Service,
    private readonly updateCompany: UpdateCompanyHandler,
    private readonly getProfile: GetCompanyFiscalProfileHandler,
    private readonly upsertProfile: UpsertCompanyFiscalProfileHandler,
    private readonly verifyTaxpayer: VerifyCompanyTaxpayerHandler,
    private readonly listEconomicActivities: ListEconomicActivitiesHandler,
    private readonly setActivityEnabled: SetActivityBillingEnabledHandler,
    private readonly setDefaultActivity: SetDefaultEconomicActivityHandler,
    private readonly configureConnection: ConfigureConnectionHandler,
    private readonly getConnection: GetConnectionHandler,
    private readonly validateConnection: ValidateConnectionHandler,
    private readonly disableConnection: DisableConnectionHandler,
    private readonly uploadCertificate: UploadFiscalSigningCertificateService,
    private readonly readCertificate: FiscalReadCertificateMetadataService,
  ) {}

  @Get('issuer')
  @Scopes('fiscal-issuer:read')
  getIssuer(@Request() req: ApiKeyRequest, @Param('companyId') companyId: string) {
    return this.onboarding.getAssociation(req.user.tenantId, companyId);
  }

  @Patch('issuer')
  @Scopes('fiscal-issuer:write')
  updateIssuer(
    @Request() req: ApiKeyRequest,
    @Param('companyId') companyId: string,
    @Body() dto: UpdateFiscalIssuerDto,
  ) {
    return this.updateCompany.execute({
      tenantId: req.user.tenantId,
      companyId,
      role: 'M2M_FISCAL_ISSUER',
      actorUserId: `apikey:${req.apiKey.keyPrefix}`,
      ...dto,
    });
  }

  @Get('profile')
  @Scopes('fiscal-profile:read')
  getFiscalProfile(@Request() req: ApiKeyRequest, @Param('companyId') companyId: string) {
    return this.getProfile.execute({
      tenantId: req.user.tenantId,
      companyId,
      role: 'M2M_FISCAL_PROFILE',
    });
  }

  @Put('profile')
  @Scopes('fiscal-profile:write')
  putFiscalProfile(
    @Request() req: ApiKeyRequest,
    @Param('companyId') companyId: string,
    @Body() dto: UpsertFiscalProfileV1Dto,
  ) {
    return this.upsertProfile.execute({
      tenantId: req.user.tenantId,
      companyId,
      actor: `apikey:${req.apiKey.keyPrefix}`,
      role: 'M2M_FISCAL_PROFILE',
      ...dto,
    });
  }

  @Post('activities/refresh')
  @Scopes('fiscal-activities:write')
  refreshActivities(@Request() req: ApiKeyRequest, @Param('companyId') companyId: string) {
    return this.verifyTaxpayer.execute({
      tenantId: req.user.tenantId,
      companyId,
      actor: `apikey:${req.apiKey.keyPrefix}`,
    });
  }

  @Get('activities')
  @Scopes('fiscal-activities:read')
  listActivities(@Request() req: ApiKeyRequest, @Param('companyId') companyId: string) {
    return this.listEconomicActivities.execute(req.user.tenantId, companyId);
  }

  @Patch('activities/:code')
  @Scopes('fiscal-activities:write')
  patchActivity(
    @Request() req: ApiKeyRequest,
    @Param('companyId') companyId: string,
    @Param('code') code: string,
    @Body() dto: SetActivityEnabledV1Dto,
  ) {
    return this.setActivityEnabled.execute({
      tenantId: req.user.tenantId,
      companyId,
      code,
      billingEnabled: dto.billingEnabled,
      actor: `apikey:${req.apiKey.keyPrefix}`,
    });
  }

  @Put('activities/default')
  @Scopes('fiscal-activities:write')
  selectDefaultActivity(
    @Request() req: ApiKeyRequest,
    @Param('companyId') companyId: string,
    @Body() dto: SetDefaultActivityV1Dto,
  ) {
    return this.setDefaultActivity.execute({
      tenantId: req.user.tenantId,
      companyId,
      code: dto.code,
      actor: `apikey:${req.apiKey.keyPrefix}`,
    });
  }

  @Get('hacienda-connection')
  @Scopes('fiscal-credentials:read')
  async readHaciendaConnection(
    @Param('companyId') companyId: string,
    @Param('environment', new ParseEnumPipe(FiscalOnboardingEnvironmentDto))
    environment: FiscalOnboardingEnvironmentDto,
  ) {
    const connection = await this.getConnection.execute(companyId, environment);
    if (!connection) throw new NotFoundException({ code: 'HACIENDA_CONNECTION_NOT_FOUND' });
    return toHaciendaConnectionResponseDto(connection);
  }

  @Put('hacienda-connection')
  @Scopes('fiscal-credentials:write')
  async putHaciendaConnection(
    @Request() req: ApiKeyRequest,
    @Param('companyId') companyId: string,
    @Param('environment', new ParseEnumPipe(FiscalOnboardingEnvironmentDto))
    environment: FiscalOnboardingEnvironmentDto,
    @Body() dto: ConfigureHaciendaCredentialsV1Dto,
  ) {
    const connection = await this.configureConnection.execute({
      tenantId: req.user.tenantId,
      companyId,
      environment,
      username: dto.username,
      password: dto.password,
    });
    return toHaciendaConnectionResponseDto(connection);
  }

  @Post('hacienda-connection/validate')
  @Scopes('fiscal-credentials:validate')
  async validateHacienda(
    @Request() req: ApiKeyRequest,
    @Param('companyId') companyId: string,
    @Param('environment', new ParseEnumPipe(FiscalOnboardingEnvironmentDto))
    environment: FiscalOnboardingEnvironmentDto,
  ) {
    const connection = await this.validateConnection.execute(
      req.user.tenantId,
      companyId,
      environment,
    );
    return toHaciendaConnectionResponseDto(connection);
  }

  @Post('hacienda-connection/disable')
  @HttpCode(HttpStatus.OK)
  @Scopes('fiscal-credentials:write')
  async disableHacienda(
    @Request() req: ApiKeyRequest,
    @Param('companyId') companyId: string,
    @Param('environment', new ParseEnumPipe(FiscalOnboardingEnvironmentDto))
    environment: FiscalOnboardingEnvironmentDto,
    @Body() _dto: DisableHaciendaConnectionV1Dto,
  ) {
    const connection = await this.disableConnection.execute(
      req.user.tenantId,
      companyId,
      environment,
    );
    return toHaciendaConnectionResponseDto(connection);
  }

  @Get('certificate')
  @Scopes('fiscal-certificates:read')
  async getCertificate(
    @Request() req: ApiKeyRequest,
    @Param('companyId') companyId: string,
    @Param('environment', new ParseEnumPipe(FiscalOnboardingEnvironmentDto))
    environment: FiscalOnboardingEnvironmentDto,
  ) {
    return this.safeCertificate(
      await this.readCertificate.execute({ tenantId: req.user.tenantId, companyId, environment }),
    );
  }

  @Post('certificate')
  @Scopes('fiscal-certificates:write')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('certificate', {
      storage: multer.memoryStorage(),
      limits: { fileSize: CERTIFICATE_LIMIT },
    }),
  )
  uploadInitialCertificate(
    @Request() req: ApiKeyRequest,
    @Param('companyId') companyId: string,
    @Param('environment', new ParseEnumPipe(FiscalOnboardingEnvironmentDto))
    environment: FiscalOnboardingEnvironmentDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('pin') pin: string | undefined,
  ) {
    return this.writeCertificate(req, companyId, environment, file, pin);
  }

  @Put('certificate')
  @Scopes('fiscal-certificates:write')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('certificate', {
      storage: multer.memoryStorage(),
      limits: { fileSize: CERTIFICATE_LIMIT },
    }),
  )
  replaceCertificate(
    @Request() req: ApiKeyRequest,
    @Param('companyId') companyId: string,
    @Param('environment', new ParseEnumPipe(FiscalOnboardingEnvironmentDto))
    environment: FiscalOnboardingEnvironmentDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('pin') pin: string | undefined,
  ) {
    return this.writeCertificate(req, companyId, environment, file, pin);
  }

  @Post('branches')
  @Scopes('fiscal-issuance-points:write')
  createBranch(
    @Request() req: ApiKeyRequest,
    @Param('companyId') companyId: string,
    @Param('environment', new ParseEnumPipe(FiscalOnboardingEnvironmentDto))
    environment: FiscalOnboardingEnvironmentDto,
    @Body() dto: CreateFiscalBranchDto,
  ) {
    return this.onboarding.createBranch({
      tenantId: req.user.tenantId,
      companyId,
      environment,
      actor: `apikey:${req.apiKey.keyPrefix}`,
      ...dto,
    });
  }

  @Get('branches')
  @Scopes('fiscal-issuance-points:read')
  listBranches(
    @Request() req: ApiKeyRequest,
    @Param('companyId') companyId: string,
    @Param('environment', new ParseEnumPipe(FiscalOnboardingEnvironmentDto))
    environment: FiscalOnboardingEnvironmentDto,
  ) {
    return this.onboarding.listBranches(req.user.tenantId, companyId, environment);
  }

  @Patch('branches/:branchId')
  @Scopes('fiscal-issuance-points:write')
  setBranchActive(
    @Request() req: ApiKeyRequest,
    @Param('companyId') companyId: string,
    @Param('environment', new ParseEnumPipe(FiscalOnboardingEnvironmentDto))
    environment: FiscalOnboardingEnvironmentDto,
    @Param('branchId') branchId: string,
    @Body() dto: SetFiscalResourceActiveDto,
  ) {
    return this.onboarding.setBranchActive({
      tenantId: req.user.tenantId,
      companyId,
      environment,
      branchId,
      active: dto.active,
      actor: `apikey:${req.apiKey.keyPrefix}`,
    });
  }

  @Post('branches/:branchId/terminals')
  @Scopes('fiscal-issuance-points:write')
  createTerminal(
    @Request() req: ApiKeyRequest,
    @Param('companyId') companyId: string,
    @Param('environment', new ParseEnumPipe(FiscalOnboardingEnvironmentDto))
    environment: FiscalOnboardingEnvironmentDto,
    @Param('branchId') branchId: string,
    @Body() dto: CreateFiscalTerminalDto,
  ) {
    return this.onboarding.createTerminal({
      tenantId: req.user.tenantId,
      companyId,
      environment,
      branchId,
      actor: `apikey:${req.apiKey.keyPrefix}`,
      ...dto,
    });
  }

  @Patch('terminals/:terminalId')
  @Scopes('fiscal-issuance-points:write')
  setTerminalActive(
    @Request() req: ApiKeyRequest,
    @Param('companyId') companyId: string,
    @Param('environment', new ParseEnumPipe(FiscalOnboardingEnvironmentDto))
    environment: FiscalOnboardingEnvironmentDto,
    @Param('terminalId') terminalId: string,
    @Body() dto: SetFiscalResourceActiveDto,
  ) {
    return this.onboarding.setTerminalActive({
      tenantId: req.user.tenantId,
      companyId,
      environment,
      terminalId,
      active: dto.active,
      actor: `apikey:${req.apiKey.keyPrefix}`,
    });
  }

  @Put('issuance-points/default')
  @Scopes('fiscal-issuance-points:write')
  selectDefaultPoint(
    @Request() req: ApiKeyRequest,
    @Param('companyId') companyId: string,
    @Param('environment', new ParseEnumPipe(FiscalOnboardingEnvironmentDto))
    environment: FiscalOnboardingEnvironmentDto,
    @Body() dto: SelectDefaultIssuancePointDto,
  ) {
    return this.onboarding.selectDefaultIssuancePoint({
      tenantId: req.user.tenantId,
      companyId,
      environment,
      terminalId: dto.terminalId,
      actor: `apikey:${req.apiKey.keyPrefix}`,
    });
  }

  @Get('issuance-points/default')
  @Scopes('fiscal-issuance-points:read')
  getDefaultPoint(
    @Request() req: ApiKeyRequest,
    @Param('companyId') companyId: string,
    @Param('environment', new ParseEnumPipe(FiscalOnboardingEnvironmentDto))
    environment: FiscalOnboardingEnvironmentDto,
  ) {
    return this.onboarding.getDefaultIssuancePoint(req.user.tenantId, companyId, environment);
  }

  @Put('terminals/:terminalId/sequences/:documentType/initial')
  @Scopes('fiscal-sequences:write')
  configureInitialSequence(
    @Request() req: ApiKeyRequest,
    @Param('companyId') companyId: string,
    @Param('environment', new ParseEnumPipe(FiscalOnboardingEnvironmentDto))
    environment: FiscalOnboardingEnvironmentDto,
    @Param('terminalId') terminalId: string,
    @Param('documentType', new ParseEnumPipe(FiscalOnboardingDocumentTypeDto))
    documentType: FiscalOnboardingDocumentTypeDto,
    @Body() dto: ConfigureInitialSequenceV1Dto,
  ) {
    return this.onboarding.configureInitialSequence({
      tenantId: req.user.tenantId,
      companyId,
      environment,
      terminalId,
      documentType,
      nextValue: BigInt(dto.nextValue),
      actor: `apikey:${req.apiKey.keyPrefix}`,
    });
  }

  @Get('terminals/:terminalId/sequences/:documentType')
  @Scopes('fiscal-sequences:read')
  getSequence(
    @Request() req: ApiKeyRequest,
    @Param('companyId') companyId: string,
    @Param('environment', new ParseEnumPipe(FiscalOnboardingEnvironmentDto))
    environment: FiscalOnboardingEnvironmentDto,
    @Param('terminalId') terminalId: string,
    @Param('documentType', new ParseEnumPipe(FiscalOnboardingDocumentTypeDto))
    documentType: FiscalOnboardingDocumentTypeDto,
  ) {
    return this.onboarding.getSequence({
      tenantId: req.user.tenantId,
      companyId,
      environment,
      terminalId,
      documentType,
    });
  }

  @Get('readiness')
  @Scopes('fiscal-readiness:read')
  readiness(
    @Request() req: ApiKeyRequest,
    @Param('companyId') companyId: string,
    @Param('environment', new ParseEnumPipe(FiscalOnboardingEnvironmentDto))
    environment: FiscalOnboardingEnvironmentDto,
  ) {
    return this.onboarding.evaluateReadiness(req.user.tenantId, companyId, environment);
  }

  @Post('test-invoices')
  @HttpCode(HttpStatus.ACCEPTED)
  @Scopes('invoices:write', 'invoices:read')
  initiateTestInvoice(
    @Request() req: ApiKeyRequest,
    @Param('companyId') companyId: string,
    @Param('environment', new ParseEnumPipe(FiscalOnboardingEnvironmentDto))
    environment: FiscalOnboardingEnvironmentDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: FiscalTestInvoiceV1Dto,
  ) {
    if (
      !idempotencyKey ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        idempotencyKey,
      )
    ) {
      throw new BadRequestException({ code: 'FISCAL_TEST_IDEMPOTENCY_KEY_INVALID' });
    }
    return this.testInvoices.initiate(
      {
        tenantId: req.user.tenantId,
        companyId,
        environment,
        apiKeyId: req.apiKey.id,
        apiKeyEnvironment: req.apiKey.environment,
        scopes: req.apiKey.scopes,
        actor: `apikey:${req.apiKey.keyPrefix}`,
      },
      idempotencyKey,
      dto,
    );
  }

  @Get('test-invoices/:executionId')
  @Scopes('invoices:write', 'invoices:read')
  getTestInvoiceStatus(
    @Request() req: ApiKeyRequest,
    @Param('companyId') companyId: string,
    @Param('environment', new ParseEnumPipe(FiscalOnboardingEnvironmentDto))
    environment: FiscalOnboardingEnvironmentDto,
    @Param('executionId', ParseUUIDPipe) executionId: string,
  ) {
    return this.testInvoices.status(
      {
        tenantId: req.user.tenantId,
        companyId,
        environment,
        apiKeyId: req.apiKey.id,
        apiKeyEnvironment: req.apiKey.environment,
        scopes: req.apiKey.scopes,
        actor: `apikey:${req.apiKey.keyPrefix}`,
      },
      executionId,
    );
  }

  private async writeCertificate(
    req: ApiKeyRequest,
    companyId: string,
    environment: FiscalOnboardingEnvironmentDto,
    file: Express.Multer.File | undefined,
    pin: string | undefined,
  ) {
    if (!file?.buffer) throw new BadRequestException({ code: 'FISCAL_CERTIFICATE_FILE_REQUIRED' });
    if (!pin?.trim()) throw new BadRequestException({ code: 'FISCAL_CERTIFICATE_PIN_REQUIRED' });
    const result = await this.uploadCertificate.execute({
      tenantId: req.user.tenantId,
      companyId,
      environment,
      pkcs12Bytes: file.buffer,
      pin,
      actorUserId: `apikey:${req.apiKey.keyPrefix}`,
      maxFileSizeBytes: CERTIFICATE_LIMIT,
    });
    return this.safeCertificate(result);
  }

  private safeCertificate(result: {
    id: string;
    companyId: string;
    environment: string;
    status: string;
    fingerprintSha256: string | null;
    serialNumber: string | null;
    subjectName: string | null;
    issuerName: string | null;
    validFrom: Date | null;
    validTo: Date | null;
    extractedIdentityNumber: string | null;
    extractedIdentityType: string | null;
    activeFrom: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return { ...result };
  }
}
