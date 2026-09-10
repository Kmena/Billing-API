import { registerAs } from '@nestjs/config';

export interface StorageConfig {
  type: 'local' | 's3';
  localStoragePath: string;
  localStorageSecret: string;
  s3Bucket?: string;
  s3Endpoint?: string;
  awsRegion: string;
}

export default registerAs('storage', (): StorageConfig => ({
  type: (process.env.STORAGE_TYPE as 'local' | 's3') ?? 'local',
  localStoragePath: process.env.LOCAL_STORAGE_PATH ?? './storage',
  localStorageSecret: process.env.LOCAL_STORAGE_SECRET ?? 'local-signing-secret-dev-only',
  s3Bucket: process.env.AWS_S3_BUCKET,
  s3Endpoint: process.env.AWS_S3_ENDPOINT,
  awsRegion: process.env.AWS_REGION ?? 'us-east-1',
}));
