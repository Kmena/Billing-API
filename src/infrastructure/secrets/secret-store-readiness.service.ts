import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { SECRET_PROVIDER, SecretProvider } from './ports/secret-provider.port';

/** Runs in API and worker application contexts before they become usable. */
@Injectable()
export class SecretStoreReadinessService implements OnApplicationBootstrap {
  constructor(@Inject(SECRET_PROVIDER) private readonly provider: SecretProvider) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.provider.ensureReady) {
      await this.provider.ensureReady();
    }
  }
}
