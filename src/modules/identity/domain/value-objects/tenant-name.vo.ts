import { ValueObject } from '../../../shared/domain/value-object';

interface TenantNameProps {
  value: string;
}

export class TenantName extends ValueObject<TenantNameProps> {
  private static readonly MIN_LENGTH = 2;
  private static readonly MAX_LENGTH = 255;

  get value(): string {
    return this.props.value;
  }

  private constructor(props: TenantNameProps) {
    super(props);
  }

  static create(name: string): TenantName {
    const trimmed = name.trim();

    if (!trimmed || trimmed.length < TenantName.MIN_LENGTH) {
      throw new Error(
        `Tenant name must be at least ${TenantName.MIN_LENGTH} characters long. Got '${trimmed}'.`,
      );
    }

    if (trimmed.length > TenantName.MAX_LENGTH) {
      throw new Error(
        `Tenant name must not exceed ${TenantName.MAX_LENGTH} characters. Got '${trimmed}'.`,
      );
    }

    return new TenantName({ value: trimmed });
  }
}
