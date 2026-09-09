export interface GetTenantResult {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly status: string;
  readonly plan: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
