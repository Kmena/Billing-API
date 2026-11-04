import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Patch,
  Param,
  ParseUUIDPipe,
  Put,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import multer = require('multer');
import { OnboardingV2LabService } from '../../application/onboarding-v2-lab.service';
import { OnboardingV2FiscalDetailsService } from '../persistence/onboarding-v2-fiscal-details.service';
import { OnboardingV2CredentialValidationService } from '../persistence/onboarding-v2-credential-validation.service';
import { ConsumerV2Guard, ConsumerV2Principal } from './consumer-v2.guard';
import { ConsumerV2RequiredScope } from './consumer-v2-scope.decorator';
import { OnboardingV2OriginGuard } from './onboarding-v2-origin.guard';
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';

@Injectable()
class NoStoreInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    context
      .switchToHttp()
      .getResponse<{ setHeader(name: string, value: string): void }>()
      .setHeader('Cache-Control', 'no-store');
    return next.handle();
  }
}
import {
  AssociateCompanyV2Dto,
  ConfigureBranchV2Dto,
  ConfigureCredentialsV2Dto,
  ConfigureIssuerV2Dto,
  PatchFiscalProfileV2Dto,
  SelectDefaultActivityV2Dto,
} from './onboarding-v2.dto';

/** Registered only in FiscalOnboardingAdminV2LabModule. No production route is enabled. */
@UseGuards(ConsumerV2Guard, OnboardingV2OriginGuard)
@UseInterceptors(NoStoreInterceptor)
@Controller('api/v2/companies/:companyId/fiscal-onboarding/:environment')
export class OnboardingV2LabController {
  constructor(
    private readonly service: OnboardingV2LabService,
    private readonly fiscalDetails: OnboardingV2FiscalDetailsService,
    private readonly credentialValidation: OnboardingV2CredentialValidationService,
  ) {}

  @Get('fiscal-details')
  @ConsumerV2RequiredScope('fiscal-v2:onboarding:read')
  details(@Req() req: { consumerV2: ConsumerV2Principal }) {
    return this.fiscalDetails.read(req.consumerV2);
  }

  @Post('taxpayer-verification')
  @ConsumerV2RequiredScope('fiscal-v2:onboarding:activity:write')
  @HttpCode(200)
  verifyTaxpayer(@Req() req: { consumerV2: ConsumerV2Principal }) {
    return this.fiscalDetails.verifyTaxpayer(req.consumerV2);
  }

  @Patch('fiscal-profile')
  @ConsumerV2RequiredScope('fiscal-v2:onboarding:profile:write')
  patchProfile(
    @Req() req: { consumerV2: ConsumerV2Principal },
    @Body() dto: PatchFiscalProfileV2Dto,
    @Headers('if-match') ifMatch: string | undefined,
  ) {
    return this.fiscalDetails.patchProfile(req.consumerV2, dto, ifMatch);
  }

  @Put('default-activity')
  @ConsumerV2RequiredScope('fiscal-v2:onboarding:activity:write')
  defaultActivity(
    @Req() req: { consumerV2: ConsumerV2Principal },
    @Body() dto: SelectDefaultActivityV2Dto,
    @Headers('if-match') ifMatch: string | undefined,
  ) {
    return this.fiscalDetails.selectDefaultActivity(req.consumerV2, dto.code, ifMatch);
  }

  @Get()
  @ConsumerV2RequiredScope('fiscal-v2:onboarding:read')
  configuration(@Req() req: { consumerV2: ConsumerV2Principal }) {
    return this.service.configuration(req.consumerV2);
  }

  @Get('status')
  @ConsumerV2RequiredScope('fiscal-v2:onboarding:read')
  status(@Req() req: { consumerV2: ConsumerV2Principal }) {
    return this.service.status(req.consumerV2);
  }

  @Put('issuer')
  @ConsumerV2RequiredScope('fiscal-v2:onboarding:issuer:write')
  issuer(@Req() req: { consumerV2: ConsumerV2Principal }, @Body() dto: ConfigureIssuerV2Dto) {
    return this.service.configureIssuer(req.consumerV2, dto);
  }

  @Post('associations')
  @ConsumerV2RequiredScope('fiscal-v2:onboarding:association:write')
  associate(@Req() req: { consumerV2: ConsumerV2Principal }, @Body() dto: AssociateCompanyV2Dto) {
    return this.service.associate(req.consumerV2, dto.externalCompanyKey);
  }

  @Put('credentials')
  @ConsumerV2RequiredScope('fiscal-v2:onboarding:credentials:write')
  configureCredentials(
    @Req() req: { consumerV2: ConsumerV2Principal },
    @Body() dto: ConfigureCredentialsV2Dto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    return this.service.credentials(req.consumerV2, dto, false, idempotencyKey ?? '');
  }

  @Post('credentials/rotate')
  @ConsumerV2RequiredScope('fiscal-v2:onboarding:credentials:write')
  @HttpCode(200)
  rotateCredentials(
    @Req() req: { consumerV2: ConsumerV2Principal },
    @Body() dto: ConfigureCredentialsV2Dto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    return this.service.credentials(req.consumerV2, dto, true, idempotencyKey ?? '');
  }

  @Post('credentials/validate')
  @ConsumerV2RequiredScope('fiscal-v2:onboarding:credentials:write')
  @HttpCode(200)
  validateCredentials(@Req() req: { consumerV2: ConsumerV2Principal }) {
    return this.credentialValidation.validate(req.consumerV2);
  }

  @Get('certificate')
  @ConsumerV2RequiredScope('fiscal-v2:onboarding:read')
  certificate(@Req() req: { consumerV2: ConsumerV2Principal }) {
    return this.service.certificateMetadata(req.consumerV2);
  }

  @Post('certificate')
  @ConsumerV2RequiredScope('fiscal-v2:onboarding:certificate:write')
  @UseInterceptors(
    FileInterceptor('certificate', {
      storage: multer.memoryStorage(),
      limits: { fileSize: 1_048_576, files: 1, fields: 1, parts: 2 },
    }),
  )
  uploadCertificate(
    @Req() req: { consumerV2: ConsumerV2Principal },
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('pin') pin: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    if (!file?.buffer || !pin || file.mimetype !== 'application/x-pkcs12')
      throw new BadRequestException({ code: 'FISCAL_CERTIFICATE_INPUT_INVALID' });
    return this.service.certificate(req.consumerV2, file.buffer, pin, idempotencyKey ?? '');
  }

  @Post('mutations/:operationId/recover')
  @ConsumerV2RequiredScope('fiscal-v2:onboarding:recovery:write')
  @HttpCode(200)
  recover(
    @Req() req: { consumerV2: ConsumerV2Principal },
    @Param('operationId', ParseUUIDPipe) operationId: string,
  ) {
    return this.service.recover(req.consumerV2, operationId);
  }

  @Put('issuance-point')
  @ConsumerV2RequiredScope('fiscal-v2:onboarding:issuance-point:write')
  issuancePoint(
    @Req() req: { consumerV2: ConsumerV2Principal },
    @Body() dto: ConfigureBranchV2Dto,
  ) {
    return this.service.configureBranch(req.consumerV2, dto);
  }

  @Post('connection-test')
  @ConsumerV2RequiredScope('fiscal-v2:onboarding:connection:test')
  @HttpCode(200)
  connectionTest(@Req() req: { consumerV2: ConsumerV2Principal }) {
    return this.service.testConnection(req.consumerV2);
  }

  @Get('audit')
  @ConsumerV2RequiredScope('fiscal-v2:onboarding:audit:read')
  audit(@Req() req: { consumerV2: ConsumerV2Principal }) {
    return this.service.audit(req.consumerV2);
  }
}
