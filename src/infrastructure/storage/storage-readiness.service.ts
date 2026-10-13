import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { STORAGE_PORT, StoragePort } from './ports/storage.port';

/**
 * Refuses to start a Billing runtime whose configured artifact store cannot be
 * reached. This runs in both the HTTP API and the worker application context.
 */
@Injectable()
export class StorageReadinessService implements OnApplicationBootstrap {
  constructor(@Inject(STORAGE_PORT) private readonly storage: StoragePort) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.storage.ensureReady();
  }
}
