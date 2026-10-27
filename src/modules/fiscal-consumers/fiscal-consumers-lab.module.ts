import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { ConsumerV2LabService } from './application/consumer-v2-lab.service';
import { ConsumerV2Guard } from './infrastructure/http/consumer-v2.guard';
import {
  ConsumerV2LabAdminController,
  ConsumerV2LabOperationController,
  ConsumerV2LabReadinessController,
} from './infrastructure/http/consumer-v2-lab.controller';
import { PrismaConsumerV2Repository } from './infrastructure/persistence/prisma-consumer-v2.repository';

/** Import explicitly in an isolated test app only. AppModule never imports this module. */
@Module({
  imports: [DatabaseModule],
  controllers: [
    ConsumerV2LabAdminController,
    ConsumerV2LabReadinessController,
    ConsumerV2LabOperationController,
  ],
  providers: [PrismaConsumerV2Repository, ConsumerV2LabService, ConsumerV2Guard],
  exports: [ConsumerV2LabService, ConsumerV2Guard, PrismaConsumerV2Repository],
})
export class FiscalConsumersLabModule {
  constructor() {
    if (process.env.NODE_ENV !== 'test') {
      throw new Error('W1_LAB_MODULE_REQUIRES_TEST_ENVIRONMENT');
    }
  }
}
