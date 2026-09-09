export interface CreateTenantResult {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly status: string;
  readonly plan: string;
  readonly createdAt: Date;
}
