import { PrismaService } from './prisma.service';
import { TenantContext } from '../tenant/tenant-context';

/**
 * Base class for all Prisma repositories that operate on tenant-scoped data.
 *
 * Subclasses must call applyTenantFilter() on every query that involves
 * tenant-owned resources. This guarantees tenant isolation at the repository level.
 *
 * BR-002: Every query on a tenant-aware repository must include WHERE tenant_id = TenantContext.get().
 * A repository without an active tenant context must NOT execute queries.
 */
export abstract class TenantAwarePrismaRepository {
  constructor(protected readonly prisma: PrismaService) {}

  /**
   * Returns the current tenant ID from the async context.
   * Throws TenantContextNotSetException if no context is active.
   */
  protected get tenantId(): string {
    return TenantContext.getTenantId();
  }

  /**
   * Merges the tenant filter into a Prisma where clause.
   * Always call this when building queries on tenant-scoped tables.
   *
   * @example
   * const user = await this.prisma.user.findFirst({
   *   where: this.applyTenantFilter({ email }),
   * });
   */
  protected applyTenantFilter<T extends Record<string, unknown>>(
    where: T = {} as T,
  ): T & { tenantId: string } {
    return {
      ...where,
      tenantId: this.tenantId,
    };
  }
}
