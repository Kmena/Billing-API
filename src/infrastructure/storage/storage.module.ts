import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { STORAGE_PORT } from './ports/storage.port';
import { LocalStorageAdapter } from './adapters/local-storage.adapter';
import { S3StorageAdapter } from './adapters/s3-storage.adapter';

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
        return new LocalStorageAdapter();
      },
      inject: [ConfigService],
    },
  ],
  exports: [STORAGE_PORT],
})
export class StorageModule {}
