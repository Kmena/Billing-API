export interface CreateTenantCommand {
  readonly name: string;
  readonly slug?: string;
  readonly correlationId?: string;
}
