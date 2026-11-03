import { Module } from '@nestjs/common';
import { FiscalOnboardingModule } from '../fiscal-onboarding/fiscal-onboarding.module';
import { HaciendaConnectionModule } from '../hacienda-connection/hacienda-connection.module';
import { FiscalDocumentsModule } from '../fiscal-documents/fiscal-documents.module';
import { FiscalConsumersLabModule } from './fiscal-consumers-lab.module';
import { OnboardingV2LabService } from './application/onboarding-v2-lab.service';
import { OnboardingV2MutationService } from './infrastructure/persistence/onboarding-v2-mutation.service';
import { OnboardingV2LabController } from './infrastructure/http/onboarding-v2-lab.controller';
import { OnboardingV2OriginGuard } from './infrastructure/http/onboarding-v2-origin.guard';
import { EnrollmentV2Controller } from './infrastructure/http/enrollment-v2.controller';
import { EnrollmentV2Guard } from './infrastructure/http/enrollment-v2.guard';
import { EnrollmentV2Service } from './infrastructure/persistence/enrollment-v2.service';

/** Explicit test import only. AppModule never registers these routes. */
@Module({
  imports: [
    FiscalConsumersLabModule,
    FiscalOnboardingModule,
    HaciendaConnectionModule,
    FiscalDocumentsModule,
  ],
  controllers: [OnboardingV2LabController, EnrollmentV2Controller],
  providers: [
    OnboardingV2LabService,
    OnboardingV2MutationService,
    OnboardingV2OriginGuard,
    EnrollmentV2Guard,
    EnrollmentV2Service,
  ],
})
export class FiscalOnboardingAdminV2LabModule {
  constructor() {
    if (process.env.NODE_ENV !== 'test') {
      throw new Error('SPEC09_LAB_MODULE_REQUIRES_TEST_ENVIRONMENT');
    }
  }
}
