export interface RefreshTokenRecord {
  readonly tokenHash: string;
  readonly userId: string;
  readonly tenantId: string;
  readonly expiresAt: Date;
  readonly used: boolean;
}

export interface IRefreshTokenRepository {
  save(record: RefreshTokenRecord): Promise<void>;
  findByHash(tokenHash: string): Promise<RefreshTokenRecord | null>;
  markAsUsed(tokenHash: string): Promise<void>;
  deleteByUserId(userId: string): Promise<void>;
}

export const REFRESH_TOKEN_REPOSITORY = Symbol('IRefreshTokenRepository');
