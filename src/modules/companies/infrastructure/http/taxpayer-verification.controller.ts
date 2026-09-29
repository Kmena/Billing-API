/**
 * TaxpayerVerificationController — Company-scoped taxpayer & economic activity onboarding.
 *
 * Routes:
 *   POST   /companies/:companyId/taxpayer-verification                    → trigger/refresh verification
 *   GET    /companies/:companyId/taxpayer-verification                    → read verification status
 *   GET    /companies/:companyId/economic-activities                      → list verified activities
 *   PATCH  /companies/:companyId/economic-activities/:code                → enable/disable for Billing
 *   PUT    /companies/:companyId/fiscal-profile/default-activity          → set default activity
 *   GET    /companies/:companyId/fiscal-onboarding/:environment/readiness → full fiscal readiness (M2M)
 *
 * Auth:
 *   - Tenant Admin JWT: all operations (existing JwtAuthGuard)
 *   - Inventori M2M API key: reads + mutations via ApiKeyAuthGuard + fiscal-onboarding scopes
 *     (DEC-007: M2M is P0)
 *
 * Readiness:
 *   - GET fiscal-onboarding/:environment/readiness exposes FiscalReadinessService.evaluate()
 *     over M2M. Read-only. No Hacienda traffic. No mutations.
 *     Scope: fiscal-onboarding:read
 *     tenantId source: authenticated API key principal only.
 *
 * Security:
 *   - Never exposes raw Hacienda JSON, Hacienda credentials, P12, PIN, or SecretProvider values.
 *   - verificationSource and verified=true cannot be set by clients.
 *   - Tenant isolation enforced by tenantId from JWT/API key.
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../../../api/guards/jwt-auth.guard';
import { ApiKeyAuthGuard } from '../../../../api/guards/api-key-auth.guard';
import { ApiKeyThrottlerGuard } from '../../../../api/guards/api-key-throttler.guard';
import { ScopeGuard } from '../../../../api/guards/scope.guard';
import { Scopes } from '../../../../api/decorators/scopes.decorator';
import type { JwtRequest } from '../../../../api/strategies/jwt.strategy';
import type { ApiKeyRequest } from '../../../../api/guards/api-key-auth.guard';
import { VerifyCompanyTaxpayerHandler } from '../../application/use-cases/verify-taxpayer/verify-company-taxpayer.handler';
import { GetTaxpayerVerificationStatusHandler } from '../../application/use-cases/get-taxpayer-verification/get-taxpayer-verification-status.handler';
import { ListEconomicActivitiesHandler } from '../../application/use-cases/list-economic-activities/list-economic-activities.handler';
import { SetActivityBillingEnabledHandler } from '../../application/use-cases/set-activity-enabled/set-activity-billing-enabled.handler';
import { SetDefaultEconomicActivityHandler } from '../../application/use-cases/set-default-activity/set-default-economic-activity.handler';
import { FiscalReadinessService } from '../../../fiscal-documents/application/fiscal-xml/fiscal-readiness.service';
import {
  EconomicActivityResponseDto,
  FiscalOnboardingStatusResponseDto,
  FiscalReadinessResponseDto,
  SetActivityBillingEnabledRequestDto,
  SetDefaultEconomicActivityRequestDto,
  SetDefaultEconomicActivityResponseDto,
  TaxpayerVerificationResponseDto,
} from './dtos/taxpayer-verification.dto';

// ─── Tenant Admin JWT controller ─────────────────────────────────────────────

@ApiTags('Taxpayer Verification (Admin)')
@SkipThrottle()
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('companies/:companyId')
export class TaxpayerVerificationController {
  constructor(
    private readonly verify: VerifyCompanyTaxpayerHandler,
    private readonly getStatus: GetTaxpayerVerificationStatusHandler,
    private readonly listActivities: ListEconomicActivitiesHandler,
    private readonly setEnabled: SetActivityBillingEnabledHandler,
    private readonly setDefault: SetDefaultEconomicActivityHandler,
  ) {}

  @Post('taxpayer-verification')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Trigger taxpayer verification via Hacienda /fe/ae (Tenant Admin)' })
  @ApiOkResponse({ type: TaxpayerVerificationResponseDto })
  async triggerVerification(
    @Request() req: { user: JwtRequest },
    @Param('companyId') companyId: string,
  ): Promise<TaxpayerVerificationResponseDto> {
    const result = await this.verify.execute({
      tenantId: req.user.tenantId,
      companyId,
      actor: req.user.userId,
    });
    return result;
  }

  @Get('taxpayer-verification')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get taxpayer verification status (Tenant Admin)' })
  @ApiOkResponse({ type: FiscalOnboardingStatusResponseDto })
  async getVerificationStatus(
    @Request() req: { user: JwtRequest },
    @Param('companyId') companyId: string,
  ): Promise<FiscalOnboardingStatusResponseDto> {
    return this.getStatus.execute(req.user.tenantId, companyId);
  }

  @Get('economic-activities')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List verified economic activities for Company (Tenant Admin)' })
  @ApiOkResponse({ type: [EconomicActivityResponseDto] })
  async listActivitiesEndpoint(
    @Request() req: { user: JwtRequest },
    @Param('companyId') companyId: string,
  ): Promise<EconomicActivityResponseDto[]> {
    return this.listActivities.execute(req.user.tenantId, companyId);
  }

  @Patch('economic-activities/:code')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Enable or disable an economic activity for Billing (Tenant Admin)' })
  @ApiOkResponse({ type: EconomicActivityResponseDto })
  async patchActivityEnabled(
    @Request() req: { user: JwtRequest },
    @Param('companyId') companyId: string,
    @Param('code') code: string,
    @Body() body: SetActivityBillingEnabledRequestDto,
  ): Promise<EconomicActivityResponseDto> {
    return this.setEnabled.execute({
      tenantId: req.user.tenantId,
      companyId,
      code,
      billingEnabled: body.billingEnabled,
      actor: req.user.userId,
    });
  }

  @Put('fiscal-profile/default-activity')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set default economic activity for fiscal documents (Tenant Admin)' })
  @ApiOkResponse({ type: SetDefaultEconomicActivityResponseDto })
  async setDefaultActivity(
    @Request() req: { user: JwtRequest },
    @Param('companyId') companyId: string,
    @Body() body: SetDefaultEconomicActivityRequestDto,
  ): Promise<SetDefaultEconomicActivityResponseDto> {
    return this.setDefault.execute({
      tenantId: req.user.tenantId,
      companyId,
      code: body.code,
      actor: req.user.userId,
    });
  }
}

// ─── Inventori M2M API key controller (fiscal-onboarding scopes) ─────────────
// DEC-007: M2M is P0 — narrow scopes, no Tenant Admin privilege.

@ApiTags('Fiscal Onboarding (M2M)')
@ApiSecurity('X-API-Key')
@UseGuards(ApiKeyAuthGuard, ApiKeyThrottlerGuard, ScopeGuard)
@Controller('companies/:companyId')
export class FiscalOnboardingM2MController {
  constructor(
    private readonly verify: VerifyCompanyTaxpayerHandler,
    private readonly getStatus: GetTaxpayerVerificationStatusHandler,
    private readonly listActivities: ListEconomicActivitiesHandler,
    private readonly setEnabled: SetActivityBillingEnabledHandler,
    private readonly setDefault: SetDefaultEconomicActivityHandler,
    private readonly readiness: FiscalReadinessService,
  ) {}

  @Post('fiscal-onboarding/verify')
  @HttpCode(HttpStatus.OK)
  @Scopes('fiscal-onboarding:write')
  @ApiOperation({ summary: 'Trigger taxpayer verification (Inventori M2M)' })
  @ApiOkResponse({ type: TaxpayerVerificationResponseDto })
  async triggerVerification(
    @Request() req: ApiKeyRequest,
    @Param('companyId') companyId: string,
  ): Promise<TaxpayerVerificationResponseDto> {
    return this.verify.execute({
      tenantId: req.user.tenantId,
      companyId,
      actor: `apikey:${req.apiKey.keyPrefix}`,
    });
  }

  @Get('fiscal-onboarding/status')
  @HttpCode(HttpStatus.OK)
  @Scopes('fiscal-onboarding:read')
  @ApiOperation({ summary: 'Get taxpayer verification status (Inventori M2M)' })
  @ApiOkResponse({ type: FiscalOnboardingStatusResponseDto })
  async getStatus2(
    @Request() req: ApiKeyRequest,
    @Param('companyId') companyId: string,
  ): Promise<FiscalOnboardingStatusResponseDto> {
    return this.getStatus.execute(req.user.tenantId, companyId);
  }

  @Get('fiscal-onboarding/activities')
  @HttpCode(HttpStatus.OK)
  @Scopes('fiscal-onboarding:read')
  @ApiOperation({ summary: 'List verified economic activities (Inventori M2M)' })
  @ApiOkResponse({ type: [EconomicActivityResponseDto] })
  async listActivitiesEndpoint(
    @Request() req: ApiKeyRequest,
    @Param('companyId') companyId: string,
  ): Promise<EconomicActivityResponseDto[]> {
    return this.listActivities.execute(req.user.tenantId, companyId);
  }

  @Patch('fiscal-onboarding/activities/:code')
  @HttpCode(HttpStatus.OK)
  @Scopes('fiscal-onboarding:write')
  @ApiOperation({ summary: 'Enable/disable an activity for Billing (Inventori M2M)' })
  @ApiOkResponse({ type: EconomicActivityResponseDto })
  async patchActivity(
    @Request() req: ApiKeyRequest,
    @Param('companyId') companyId: string,
    @Param('code') code: string,
    @Body() body: SetActivityBillingEnabledRequestDto,
  ): Promise<EconomicActivityResponseDto> {
    return this.setEnabled.execute({
      tenantId: req.user.tenantId,
      companyId,
      code,
      billingEnabled: body.billingEnabled,
      actor: `apikey:${req.apiKey.keyPrefix}`,
    });
  }

  @Put('fiscal-onboarding/default-activity')
  @HttpCode(HttpStatus.OK)
  @Scopes('fiscal-onboarding:write')
  @ApiOperation({ summary: 'Set default economic activity (Inventori M2M)' })
  @ApiOkResponse({ type: SetDefaultEconomicActivityResponseDto })
  async setDefault2(
    @Request() req: ApiKeyRequest,
    @Param('companyId') companyId: string,
    @Body() body: SetDefaultEconomicActivityRequestDto,
  ): Promise<SetDefaultEconomicActivityResponseDto> {
    return this.setDefault.execute({
      tenantId: req.user.tenantId,
      companyId,
      code: body.code,
      actor: `apikey:${req.apiKey.keyPrefix}`,
    });
  }

  /**
   * GET /companies/:companyId/fiscal-onboarding/:environment/readiness
   *
   * Evaluates full fiscal readiness via FiscalReadinessService.
   * Read-only — zero mutations, zero Hacienda HTTP calls.
   * tenantId is resolved exclusively from the authenticated API key principal.
   *
   * Response NEVER contains: P12, PIN, certificateSecretReference,
   * passwordSecretReference, Hacienda credentials, or OAuth tokens.
   */
  @Get('fiscal-onboarding/:environment/readiness')
  @HttpCode(HttpStatus.OK)
  @Scopes('fiscal-onboarding:read')
  @ApiOperation({
    summary: 'Evaluate full fiscal readiness (Inventori M2M)',
    description:
      'Returns readyToIssue verdict with hard-blocker reasonCodes and informational warnings. ' +
      'Read-only — performs no Hacienda calls, no mutations. ' +
      'Billing is the authoritative source; do NOT synthesize readiness in Inventori.',
  })
  @ApiOkResponse({ type: FiscalReadinessResponseDto })
  async getFiscalReadiness(
    @Request() req: ApiKeyRequest,
    @Param('companyId') companyId: string,
    @Param('environment') environment: string,
  ): Promise<FiscalReadinessResponseDto> {
    const result = await this.readiness.evaluate({
      tenantId: req.user.tenantId, // always from authenticated API-key principal
      companyId,
      environment,
    });
    // Explicit projection — never spread FiscalReadinessResult.
    // activeCertificate is excluded: not part of FiscalReadinessResponseDto contract.
    // Secret references (certificateSecretReference, passwordSecretReference) are never
    // reachable here; they are consumed internally by FiscalReadinessService only.
    return {
      companyId: result.companyId,
      environment: result.environment,
      readyToIssue: result.readyToIssue,
      reasonCodes: result.reasonCodes,
      warnings: result.warnings,
      checkedAt: result.checkedAt,
    };
  }
}
