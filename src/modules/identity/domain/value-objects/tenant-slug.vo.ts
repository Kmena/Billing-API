import { ValueObject } from '../../../shared/domain/value-object';

interface TenantSlugProps {
  value: string;
}

export class TenantSlug extends ValueObject<TenantSlugProps> {
  private static readonly SLUG_REGEX = /^[a-z0-9][a-z0-9-]{1,98}[a-z0-9]$|^[a-z0-9]{3}$/;
  private static readonly MIN_LENGTH = 3;
  private static readonly MAX_LENGTH = 100;

  get value(): string {
    return this.props.value;
  }

  private constructor(props: TenantSlugProps) {
    super(props);
  }

  static create(rawSlug: string): TenantSlug {
    const slug = rawSlug.trim().toLowerCase();
    TenantSlug.validate(slug);
    return new TenantSlug({ value: slug });
  }

  /**
   * Generates a URL-safe slug from a tenant name.
   * Converts spaces and special characters to hyphens.
   */
  static fromName(name: string): TenantSlug {
    const slug = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '') // remove non-alphanumeric, non-space, non-hyphen
      .replace(/[\s]+/g, '-') // replace whitespace with hyphens
      .replace(/-+/g, '-') // collapse multiple hyphens
      .replace(/^-|-$/g, ''); // remove leading/trailing hyphens

    const truncated = slug.substring(0, TenantSlug.MAX_LENGTH);
    const cleaned = truncated.replace(/^-|-$/g, '');

    if (cleaned.length < TenantSlug.MIN_LENGTH) {
      throw new Error(
        `Cannot generate a valid slug from name '${name}'. Resulting slug '${cleaned}' is too short.`,
      );
    }

    return new TenantSlug({ value: cleaned });
  }

  private static validate(slug: string): void {
    if (!slug || slug.length < TenantSlug.MIN_LENGTH) {
      throw new Error(
        `Tenant slug must be at least ${TenantSlug.MIN_LENGTH} characters long. Got '${slug}'.`,
      );
    }

    if (slug.length > TenantSlug.MAX_LENGTH) {
      throw new Error(
        `Tenant slug must not exceed ${TenantSlug.MAX_LENGTH} characters. Got '${slug}'.`,
      );
    }

    if (!TenantSlug.SLUG_REGEX.test(slug)) {
      throw new Error(
        `Tenant slug '${slug}' is invalid. Must be lowercase alphanumeric with hyphens (no leading/trailing hyphens).`,
      );
    }
  }
}
