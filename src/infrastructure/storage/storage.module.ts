import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { STORAGE_PORT } from './ports/storage.port';
import { LocalStorageAdapter } from './adapters/local-storage.adapter';
import { S3StorageAdapter } from './adapters/s3-storage.adapter';
import type { StorageConfig } from '../config/storage.config';

@Global()
@Module({
  providers: [
    {
      provide: STORAGE_PORT,
      useFactory: (configService: ConfigService) => {
        const storageType = configService.get<string>('storage.type') ?? 'local';
        if (storageType === 's3') {
          return new S3StorageAdapter(configService);
        }
        const storageCfg = configService.get<StorageConfig>('storage');
        return new LocalStorageAdapter(
          storageCfg?.localStoragePath,
          storageCfg?.localStorageSecret,
        );
      },
      inject: [ConfigService],
    },
  ],
  exports: [STORAGE_PORT],
})
export class StorageModule {}
