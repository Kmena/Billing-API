import { Injectable } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ConfigService } from '@nestjs/config';
import { StoragePort } from '../ports/storage.port';

/**
 * S3StorageAdapter — AWS S3 storage adapter.
 * Works with AWS S3 in production and LocalStack in development.
 * NFR-009: All objects are private by default; access via signed URLs.
 */
@Injectable()
export class S3StorageAdapter implements StoragePort {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(configService: ConfigService) {
    const region = configService.get<string>('storage.awsRegion') ?? 'us-east-1';
    const endpoint = configService.get<string>('storage.s3Endpoint');
    this.bucket = configService.get<string>('storage.s3Bucket') ?? 'billing-documents';

    this.client = new S3Client({
      region,
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    });
  }

  async upload(key: string, content: Buffer, metadata?: Record<string, string>): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: content,
        Metadata: metadata,
        // All objects are private by default — NFR-009
      }),
    );
    return key;
  }

  async download(key: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );

    const chunks: Uint8Array[] = [];
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  async getSignedUrl(key: string, expiresInSeconds: number): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
