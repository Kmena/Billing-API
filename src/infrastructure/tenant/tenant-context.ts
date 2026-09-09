import { AsyncLocalStorage } from 'async_hooks';

interface TenantStore {
  tenantId: string;
}

export class TenantContextNotSetException extends Error {
  constructor() {
    super(
      'TenantContext is not set. A tenant context must be established before accessing tenant-scoped resources.',
    );
    this.name = 'TenantContextNotSetException';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class TenantContext {
  private static readonly storage = new AsyncLocalStorage<TenantStore>();

  /**
   * Runs the given function within a tenant context.
   * All async operations within fn() will have access to the tenantId via getTenantId().
   */
  static run<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    return TenantContext.storage.run({ tenantId }, fn);
  }

  /**
   * Returns the current tenant ID from the async context.
   * Throws TenantContextNotSetException if called outside of a run() scope.
   */
  static getTenantId(): string {
    const store = TenantContext.storage.getStore();
    if (!store) {
      throw new TenantContextNotSetException();
    }
    return store.tenantId;
  }

  /**
   * Returns the current tenant ID or null if not in a tenant context.
   * Use this when tenant context is optional (e.g., health checks).
   */
  static getTenantIdOrNull(): string | null {
    const store = TenantContext.storage.getStore();
    return store?.tenantId ?? null;
  }
}
