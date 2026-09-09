import { TenantSlug } from '../value-objects/tenant-slug.vo';

describe('TenantSlug VO', () => {
  describe('TenantSlug.create()', () => {
    it('creates a valid slug from a lowercase string', () => {
      const slug = TenantSlug.create('my-company');
      expect(slug.value).toBe('my-company');
    });

    it('normalizes to lowercase', () => {
      const slug = TenantSlug.create('My-Company');
      expect(slug.value).toBe('my-company');
    });

    it('accepts alphanumeric slugs', () => {
      const slug = TenantSlug.create('abc');
      expect(slug.value).toBe('abc');
    });

    it('accepts slugs with hyphens between chars', () => {
      const slug = TenantSlug.create('a1b-c2d');
      expect(slug.value).toBe('a1b-c2d');
    });

    it('throws for slug that is too short (< 3 chars)', () => {
      expect(() => TenantSlug.create('ab')).toThrow();
    });

    it('throws for slug that is too long (> 100 chars)', () => {
      const longSlug = 'a'.repeat(101);
      expect(() => TenantSlug.create(longSlug)).toThrow();
    });

    it('throws for slug with leading hyphen', () => {
      expect(() => TenantSlug.create('-my-company')).toThrow();
    });

    it('throws for slug with trailing hyphen', () => {
      expect(() => TenantSlug.create('my-company-')).toThrow();
    });

    it('throws for slug with uppercase letters', () => {
      // After normalization to lowercase, this passes — so test non-normalizable chars
      expect(() => TenantSlug.create('my company')).toThrow();
    });

    it('throws for slug with special characters', () => {
      expect(() => TenantSlug.create('my@company')).toThrow();
    });
  });

  describe('TenantSlug.fromName()', () => {
    it('generates a valid slug from a company name', () => {
      const slug = TenantSlug.fromName('Acme Corporation');
      expect(slug.value).toBe('acme-corporation');
    });

    it('removes special characters', () => {
      const slug = TenantSlug.fromName('Acme & Sons Ltd.');
      expect(slug.value).toBe('acme-sons-ltd');
    });

    it('collapses multiple spaces to single hyphen', () => {
      const slug = TenantSlug.fromName('My   Company   Name');
      expect(slug.value).toBe('my-company-name');
    });

    it('collapses multiple hyphens', () => {
      const slug = TenantSlug.fromName('My--Company');
      expect(slug.value).toBe('my-company');
    });

    it('throws when name cannot produce a valid slug', () => {
      expect(() => TenantSlug.fromName('AB')).toThrow();
    });
  });

  describe('equals()', () => {
    it('two slugs with same value are equal', () => {
      const a = TenantSlug.create('my-company');
      const b = TenantSlug.create('my-company');
      expect(a.equals(b)).toBe(true);
    });

    it('two slugs with different values are not equal', () => {
      const a = TenantSlug.create('company-a');
      const b = TenantSlug.create('company-b');
      expect(a.equals(b)).toBe(false);
    });
  });
});
