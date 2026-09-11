import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';
import { IRefreshTokenRepository } from '../../domain/ports/refresh-token.repository';
import { IUserRepository } from '../../domain/ports/user.repository';
import { User } from '../../domain/entities/user.entity';
import { InvalidRefreshTokenException } from '../../domain/exceptions/invalid-refresh-token.exception';
import { RefreshTokenHandler } from '../use-cases/refresh-token/refresh-token.handler';

describe('RefreshTokenHandler', () => {
  let handler: RefreshTokenHandler;
  let mockUserRepository: jest.Mocked<IUserRepository>;
  let mockRefreshTokenRepository: jest.Mocked<IRefreshTokenRepository>;
  let mockJwtService: jest.Mocked<JwtService>;

  const now = new Date('2026-09-11T12:00:00.000Z');
  const rawRefreshToken = 'valid-refresh-token';
  const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);

    mockUserRepository = {
      findById: jest.fn(),
      findByEmail: jest.fn(),
      save: jest.fn(),
    };

    mockRefreshTokenRepository = {
      save: jest.fn(),
      findByHash: jest.fn(),
      markAsUsed: jest.fn(),
      deleteByUserId: jest.fn(),
    };

    mockJwtService = {
      sign: jest.fn().mockReturnValue('rotated-access-token'),
    } as unknown as jest.Mocked<JwtService>;

    const mockConfigService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'auth.jwtExpiresIn') return '30m';
        if (key === 'auth.jwtRefreshExpiresIn') return '2d';
        return undefined;
      }),
    } as unknown as ConfigService;

    handler = new RefreshTokenHandler(
      mockUserRepository,
      mockRefreshTokenRepository,
      mockJwtService,
      mockConfigService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('rotates a valid refresh token using configured access and refresh expiry', async () => {
    const user = createUser('ACTIVE');
    mockRefreshTokenRepository.findByHash.mockResolvedValue({
      tokenHash,
      userId: user.id,
      tenantId: user.tenantId,
      expiresAt: new Date('2026-09-12T12:00:00.000Z'),
      used: false,
    });
    mockUserRepository.findById.mockResolvedValue(user);
    mockRefreshTokenRepository.markAsUsed.mockResolvedValue(undefined);
    mockRefreshTokenRepository.save.mockResolvedValue(undefined);

    const result = await handler.execute({ refreshToken: rawRefreshToken });

    expect(result.accessToken).toBe('rotated-access-token');
    expect(result.refreshToken).toBeDefined();
    expect(result.refreshToken).not.toBe(rawRefreshToken);
    expect(result.expiresIn).toBe(900);
    expect(mockJwtService.sign).toHaveBeenCalledWith(expect.any(Object), { expiresIn: '30m' });
    expect(mockRefreshTokenRepository.markAsUsed).toHaveBeenCalledWith(tokenHash);
    expect(mockRefreshTokenRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: user.id,
        tenantId: user.tenantId,
        expiresAt: new Date('2026-09-13T12:00:00.000Z'),
        used: false,
      }),
    );
  });

  it('rejects an unknown refresh token', async () => {
    mockRefreshTokenRepository.findByHash.mockResolvedValue(null);

    await expect(handler.execute({ refreshToken: rawRefreshToken })).rejects.toThrow(
      InvalidRefreshTokenException,
    );
    expect(mockRefreshTokenRepository.markAsUsed).not.toHaveBeenCalled();
  });

  it('rejects a reused refresh token', async () => {
    mockRefreshTokenRepository.findByHash.mockResolvedValue({
      tokenHash,
      userId: 'user-id-1',
      tenantId: 'tenant-id-1',
      expiresAt: new Date('2026-09-12T12:00:00.000Z'),
      used: true,
    });

    await expect(handler.execute({ refreshToken: rawRefreshToken })).rejects.toThrow(
      InvalidRefreshTokenException,
    );
    expect(mockRefreshTokenRepository.markAsUsed).not.toHaveBeenCalled();
  });

  it('rejects an expired refresh token', async () => {
    mockRefreshTokenRepository.findByHash.mockResolvedValue({
      tokenHash,
      userId: 'user-id-1',
      tenantId: 'tenant-id-1',
      expiresAt: new Date('2026-09-10T12:00:00.000Z'),
      used: false,
    });

    await expect(handler.execute({ refreshToken: rawRefreshToken })).rejects.toThrow(
      InvalidRefreshTokenException,
    );
    expect(mockRefreshTokenRepository.markAsUsed).not.toHaveBeenCalled();
  });

  it('rejects refresh token rotation for inactive users', async () => {
    mockRefreshTokenRepository.findByHash.mockResolvedValue({
      tokenHash,
      userId: 'user-id-1',
      tenantId: 'tenant-id-1',
      expiresAt: new Date('2026-09-12T12:00:00.000Z'),
      used: false,
    });
    mockUserRepository.findById.mockResolvedValue(createUser('INACTIVE'));

    await expect(handler.execute({ refreshToken: rawRefreshToken })).rejects.toThrow(
      InvalidRefreshTokenException,
    );
    expect(mockRefreshTokenRepository.markAsUsed).not.toHaveBeenCalled();
  });
});

function createUser(status: 'ACTIVE' | 'INACTIVE'): User {
  return User.reconstruct({
    id: 'user-id-1',
    tenantId: 'tenant-id-1',
    email: 'admin@test.com',
    passwordHash: 'hash',
    role: 'TENANT_ADMIN',
    status,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
  });
}
