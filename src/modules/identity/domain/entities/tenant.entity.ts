import { AggregateRoot } from '../../../shared/domain/aggregate-root';
import { TenantName } from '../value-objects/tenant-name.vo';
import { TenantSlug } from '../value-objects/tenant-slug.vo';
import { TenantCreatedEvent } from '../events/tenant-created.event';

export type TenantStatus = 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';
export type TenantPlan = 'TRIAL' | 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE';

interface TenantProps {
  name: TenantName;
  slug: TenantSlug;
  status: TenantStatus;
  plan: TenantPlan;
  metadata?: Record<string, unknown>;
}

export interface TenantReconstructProps {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  plan: TenantPlan;
  metadata?: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export class Tenant extends AggregateRoot<string> {
  private readonly _name: TenantName;
  private readonly _slug: TenantSlug;
  private _status: TenantStatus;
  private readonly _plan: TenantPlan;
  private readonly _metadata?: Record<string, unknown>;

  private constructor(id: string, props: TenantProps, createdAt?: Date, updatedAt?: Date) {
    super(id, createdAt, updatedAt);
    this._name = props.name;
    this._slug = props.slug;
    this._status = props.status;
    this._plan = props.plan;
    this._metadata = props.metadata;
  }

  get name(): string {
    return this._name.value;
  }

  get slug(): string {
    return this._slug.value;
  }

  get status(): TenantStatus {
    return this._status;
  }

  get plan(): TenantPlan {
    return this._plan;
  }

  get metadata(): Record<string, unknown> | undefined {
    return this._metadata;
  }

  /**
   * Factory method: creates a new Tenant aggregate with a generated UUID and domain event.
   * BR-008: TenantSlug is immutable after creation.
   */
  static create(id: string, name: string, slug?: string, correlationId?: string): Tenant {
    const tenantName = TenantName.create(name);
    const tenantSlug = slug ? TenantSlug.create(slug) : TenantSlug.fromName(name);

    const tenant = new Tenant(id, {
      name: tenantName,
      slug: tenantSlug,
      status: 'ACTIVE',
      plan: 'TRIAL',
    });

    tenant.addDomainEvent(new TenantCreatedEvent(id, tenantSlug.value, correlationId));

    return tenant;
  }

  /**
   * Reconstructs a Tenant from persisted data without raising domain events.
   */
  static reconstruct(props: TenantReconstructProps): Tenant {
    return new Tenant(
      props.id,
      {
        name: TenantName.create(props.name),
        slug: TenantSlug.create(props.slug),
        status: props.status,
        plan: props.plan,
        metadata: props.metadata ?? undefined,
      },
      props.createdAt,
      props.updatedAt,
    );
  }

  suspend(): void {
    this._status = 'SUSPENDED';
    this.updatedAt = new Date();
  }

  activate(): void {
    this._status = 'ACTIVE';
    this.updatedAt = new Date();
  }
}
