import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JOB_QUEUE } from './ports/job-queue.port';
import { PgBossJobQueue } from './adapters/pgboss-job-queue.adapter';
import { InMemoryJobQueue } from './adapters/in-memory-job-queue.adapter';

@Module({
  providers: [
    {
      provide: JOB_QUEUE,
      useFactory: (configService: ConfigService) => {
        const isTest = configService.get<string>('app.nodeEnv') === 'test';
        if (
          isTest &&
          !(
            process.env.BILLING_SPEC09_PERSISTENT_SANDBOX === 'true' &&
            process.env.BILLING_SPEC09_STAG_INVOICING === 'true'
          )
        ) {
          return new InMemoryJobQueue();
        }
        return new PgBossJobQueue(configService);
      },
      inject: [ConfigService],
    },
  ],
  exports: [JOB_QUEUE],
})
export class QueueModule {}
