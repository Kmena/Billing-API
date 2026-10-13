import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { STORAGE_PORT } from './ports/storage.port';
import { LocalStorageAdapter } from './adapters/local-storage.adapter';
import { S3StorageAdapter } from './adapters/s3-storage.adapter';
import { StorageReadinessService } from './storage-readiness.service';
import type { StorageConfig } from '../config/storage.config';

@Global()
@Module({
  providers: [
    StorageReadinessService,
    {
      provide: STORAGE_PORT,
      useFactory: (configService: ConfigService) => {
        const storageType = configService.get<string>('storage.type');
        if (storageType === 's3') {
          return new S3StorageAdapter(configService);
        }
        if (storageType !== 'local') {
          throw new Error('Unsupported explicit storage provider: ' + (storageType ?? 'missing'));
        }
        const storageCfg = configService.get<StorageConfig>('storage');
        return new LocalStorageAdapter(
          storageCfg?.localStoragePath,
          storageCfg?.localStorageSecret,
          storageCfg?.localStorageRequiredMarker,
        );
      },
      inject: [ConfigService],
    },
  ],
  exports: [STORAGE_PORT],
})
export class StorageModule {}
