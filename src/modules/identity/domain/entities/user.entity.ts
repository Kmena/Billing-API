import { AggregateRoot } from '../../../shared/domain/aggregate-root';
import { Email } from '../value-objects/email.vo';

export type UserRole = 'TENANT_ADMIN' | 'MEMBER' | 'READ_ONLY';
export type UserStatus = 'ACTIVE' | 'INACTIVE' | 'PENDING_VERIFICATION';

interface UserProps {
  tenantId: string;
  email: Email;
  passwordHash: string; // argon2id hash — never expose in DTOs
  firstName?: string;
  lastName?: string;
  role: UserRole;
  status: UserStatus;
  lastLoginAt?: Date;
}

export interface UserReconstructProps {
  id: string;
  tenantId: string;
  email: string;
  passwordHash: string;
  firstName?: string | null;
  lastName?: string | null;
  role: UserRole;
  status: UserStatus;
  lastLoginAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class User extends AggregateRoot<string> {
  private readonly _tenantId: string;
  private readonly _email: Email;
  private readonly _passwordHash: string; // NEVER exposed in DTOs
  private readonly _firstName?: string;
  private readonly _lastName?: string;
  private _role: UserRole;
  private _status: UserStatus;
  private _lastLoginAt?: Date;

  private constructor(id: string, props: UserProps, createdAt?: Date, updatedAt?: Date) {
    super(id, createdAt, updatedAt);
    this._tenantId = props.tenantId;
    this._email = props.email;
    this._passwordHash = props.passwordHash;
    this._firstName = props.firstName;
    this._lastName = props.lastName;
    this._role = props.role;
    this._status = props.status;
    this._lastLoginAt = props.lastLoginAt;
  }

  get tenantId(): string {
    return this._tenantId;
  }

  get email(): string {
    return this._email.value;
  }

  // BR-004: passwordHash is never exposed in DTOs — this getter is for internal use only
  get passwordHash(): string {
    return this._passwordHash;
  }

  get firstName(): string | undefined {
    return this._firstName;
  }

  get lastName(): string | undefined {
    return this._lastName;
  }

  get role(): UserRole {
    return this._role;
  }

  get status(): UserStatus {
    return this._status;
  }

  get lastLoginAt(): Date | undefined {
    return this._lastLoginAt;
  }

  get isActive(): boolean {
    return this._status === 'ACTIVE';
  }

  recordLogin(): void {
    this._lastLoginAt = new Date();
    this.updatedAt = new Date();
  }

  static create(
    id: string,
    tenantId: string,
    email: string,
    passwordHash: string,
    role: UserRole = 'MEMBER',
    firstName?: string,
    lastName?: string,
  ): User {
    return new User(id, {
      tenantId,
      email: Email.create(email),
      passwordHash,
      firstName,
      lastName,
      role,
      status: 'ACTIVE',
    });
  }

  static reconstruct(props: UserReconstructProps): User {
    return new User(
      props.id,
      {
        tenantId: props.tenantId,
        email: Email.create(props.email),
        passwordHash: props.passwordHash,
        firstName: props.firstName ?? undefined,
        lastName: props.lastName ?? undefined,
        role: props.role,
        status: props.status,
        lastLoginAt: props.lastLoginAt ?? undefined,
      },
      props.createdAt,
      props.updatedAt,
    );
  }
}
