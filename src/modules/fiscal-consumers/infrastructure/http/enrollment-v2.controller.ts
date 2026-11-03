import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import multer = require('multer');
import { EnrollmentV2Service } from '../persistence/enrollment-v2.service';
import { EnrollmentV2Guard, EnrollmentV2Principal } from './enrollment-v2.guard';
import { OnboardingV2OriginGuard } from './onboarding-v2-origin.guard';

/** Exists only in the explicit test/lab module. */
@Controller('api/v2/companies/:companyId/fiscal-onboarding/:environment/requests')
@UseGuards(EnrollmentV2Guard, OnboardingV2OriginGuard)
export class EnrollmentV2Controller {
  constructor(private readonly service: EnrollmentV2Service) {}

  @Post()
  @HttpCode(200)
  @UseInterceptors(
    FileInterceptor('certificate', {
      storage: multer.memoryStorage(),
      limits: { fileSize: 1_048_576, files: 1, fields: 5, parts: 6 },
    }),
  )
  request(
    @Req()
    req: {
      enrollmentV2: EnrollmentV2Principal;
      res: { setHeader(name: string, value: string): void };
    },
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('externalCompanyKey') externalCompanyKey: string,
    @Body('issuerIdentificationNumber') issuerIdentificationNumber: string | undefined,
    @Body('pin') pin: string,
    @Body('username') username: string,
    @Body('password') password: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    req.res.setHeader('Cache-Control', 'no-store');
    if (!file?.buffer || file.mimetype !== 'application/x-pkcs12')
      throw new BadRequestException({ code: 'FISCAL_CERTIFICATE_INPUT_INVALID' });
    return this.service.request(
      req.enrollmentV2,
      {
        externalCompanyKey,
        issuerIdentificationNumber,
        pin,
        username,
        password,
      },
      file.buffer,
      idempotencyKey ?? '',
    );
  }

  @Post(':requestId/recover')
  @HttpCode(200)
  recover(
    @Req()
    req: {
      enrollmentV2: EnrollmentV2Principal;
      res: { setHeader(name: string, value: string): void };
    },
    @Param('requestId', ParseUUIDPipe) requestId: string,
  ) {
    req.res.setHeader('Cache-Control', 'no-store');
    return this.service.recover(req.enrollmentV2, requestId);
  }
}
