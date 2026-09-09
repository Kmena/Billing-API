import { AggregateRoot } from '../../../shared/domain/aggregate-root';

export type ApiKeyStatus = 'ACTIVE' | 'REVOKED' | 'EXPIRED';
export type ApiKeyEnvironment = 'LIVE' | 'TEST';

interface ApiKeyProps {
  tenantId: string;
  name: string;
  environment: ApiKeyEnvironment;
  keyPrefix: string; // 8-char prefix stored in plaintext for lookup
  keyHash: string; // argon2id hash of the secret — NEVER expose
  scopes: string[];
  status: ApiKeyStatus;
  expiresAt?: Date;
  lastUsedAt?: Date;
  revokedAt?: Date;
  revokedBy?: string;
}

export interface ApiKeyReconstructProps {
  id: string;
  tenantId: string;
  name: string;
  environment: ApiKeyEnvironment;
  keyPrefix: string;
  keyHash: string;
  scopes: string[];
  status: ApiKeyStatus;
  expiresAt?: Date | null;
  lastUsedAt?: Date | null;
  revokedAt?: Date | null;
  revokedBy?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class ApiKey extends AggregateRoot<string> {
  private readonly _tenantId: string;
  private readonly _name: string;
  private readonly _environment: ApiKeyEnvironment;
  private readonly _keyPrefix: string;
  private readonly _keyHash: string; // BR-001: argon2id one-way hash
  private readonly _scopes: string[];
  private _status: ApiKeyStatus;
  private readonly _expiresAt?: Date;
  private _lastUsedAt?: Date;
  private _revokedAt?: Date;
  private _revokedBy?: string;

  private constructor(id: string, props: ApiKeyProps, createdAt?: Date, updatedAt?: Date) {
    super(id, createdAt, updatedAt);
    this._tenantId = props.tenantId;
    this._name = props.name;
    this._environment = props.environment;
    this._keyPrefix = props.keyPrefix;
    this._keyHash = props.keyHash;
    this._scopes = [...props.scopes];
    this._status = props.status;
    this._expiresAt = props.expiresAt;
    this._lastUsedAt = props.lastUsedAt;
    this._revokedAt = props.revokedAt;
    this._revokedBy = props.revokedBy;
  }

  get tenantId(): string {
    return this._tenantId;
  }

  get name(): string {
    return this._name;
  }

  get environment(): ApiKeyEnvironment {
    return this._environment;
  }

  get keyPrefix(): string {
    return this._keyPrefix;
  }

  // BR-001: keyHash is for internal validation only — NEVER expose in any DTO
  get keyHash(): string {
    return this._keyHash;
  }

  get scopes(): string[] {
    return [...this._scopes];
  }

  get status(): ApiKeyStatus {
    return this._status;
  }

  get expiresAt(): Date | undefined {
    return this._expiresAt;
  }

  get lastUsedAt(): Date | undefined {
    return this._lastUsedAt;
  }

  get revokedAt(): Date | undefined {
    return this._revokedAt;
  }

  get revokedBy(): string | undefined {
    return this._revokedBy;
  }

  get isActive(): boolean {
    return this._status === 'ACTIVE';
  }

  get isRevoked(): boolean {
    return this._status === 'REVOKED';
  }

  get isExpired(): boolean {
    if (this._expiresAt && new Date() > this._expiresAt) return true;
    return this._status === 'EXPIRED';
  }

  /**
   * Revokes this API key. Idempotent — BR-005.
   */
  revoke(revokedBy: string): void {
    // BR-005: Idempotent — revoking an already-revoked key is a no-op
    if (this._status === 'REVOKED') return;

    this._status = 'REVOKED';
    this._revokedAt = new Date();
    this._revokedBy = revokedBy;
    this.updatedAt = new Date();
  }

  recordUsage(): void {
    this._lastUsedAt = new Date();
    this.updatedAt = new Date();
  }

  static create(
    id: string,
    tenantId: string,
    name: string,
    environment: ApiKeyEnvironment,
    keyPrefix: string,
    keyHash: string,
    scopes: string[],
    expiresAt?: Date,
  ): ApiKey {
    return new ApiKey(id, {
      tenantId,
      name,
      environment,
      keyPrefix,
      keyHash,
      scopes,
      status: 'ACTIVE',
      expiresAt,
    });
  }

  static reconstruct(props: ApiKeyReconstructProps): ApiKey {
    return new ApiKey(
      props.id,
      {
        tenantId: props.tenantId,
        name: props.name,
        environment: props.environment,
        keyPrefix: props.keyPrefix,
        keyHash: props.keyHash,
        scopes: props.scopes,
        status: props.status,
        expiresAt: props.expiresAt ?? undefined,
        lastUsedAt: props.lastUsedAt ?? undefined,
        revokedAt: props.revokedAt ?? undefined,
        revokedBy: props.revokedBy ?? undefined,
      },
      props.createdAt,
      props.updatedAt,
    );
  }
}
