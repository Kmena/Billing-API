import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { LoginHandler } from '../use-cases/login/login.handler';
import { IUserRepository } from '../../domain/ports/user.repository';
import { IRefreshTokenRepository } from '../../domain/ports/refresh-token.repository';
import { InvalidCredentialsException } from '../../domain/exceptions/invalid-credentials.exception';
import { User } from '../../domain/entities/user.entity';
import * as argon2 from 'argon2';

describe('LoginHandler', () => {
  let handler: LoginHandler;
  let mockUserRepo: jest.Mocked<IUserRepository>;
  let mockRefreshTokenRepo: jest.Mocked<IRefreshTokenRepository>;
  let mockJwtService: jest.Mocked<JwtService>;

  beforeEach(() => {
    mockUserRepo = {
      findById: jest.fn(),
      findByEmail: jest.fn(),
      save: jest.fn(),
    };

    mockRefreshTokenRepo = {
      save: jest.fn(),
      findByHash: jest.fn(),
      markAsUsed: jest.fn(),
      deleteByUserId: jest.fn(),
    };

    mockJwtService = {
      sign: jest.fn().mockReturnValue('mocked-access-token'),
    } as unknown as jest.Mocked<JwtService>;

    const mockConfigService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'auth.jwtExpiresIn') return '15m';
        if (key === 'auth.jwtRefreshExpiresIn') return '7d';
        return undefined;
      }),
    } as unknown as ConfigService;

    handler = new LoginHandler(
      mockUserRepo,
      mockRefreshTokenRepo,
      mockJwtService,
      mockConfigService,
    );
  });

  describe('execute()', () => {
    it('returns tokens for valid credentials', async () => {
      const passwordHash = await argon2.hash('correct-password', { type: argon2.argon2id });
      const user = User.reconstruct({
        id: 'user-id-1',
        tenantId: 'tenant-id-1',
        email: 'admin@test.com',
        passwordHash,
        role: 'TENANT_ADMIN',
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      mockUserRepo.findByEmail.mockResolvedValue(user);
      mockUserRepo.save.mockResolvedValue(undefined);
      mockRefreshTokenRepo.save.mockResolvedValue(undefined);

      const result = await handler.execute({
        tenantId: 'tenant-id-1',
        email: 'admin@test.com',
        password: 'correct-password',
      });

      expect(result.accessToken).toBe('mocked-access-token');
      expect(result.refreshToken).toBeDefined();
      expect(result.expiresIn).toBe(900);
    });

    it('derives expiresIn from configured jwtExpiresIn duration', async () => {
      const passwordHash = await argon2.hash('correct-password', { type: argon2.argon2id });
      const user = User.reconstruct({
        id: 'user-id-1',
        tenantId: 'tenant-id-1',
        email: 'admin@test.com',
        passwordHash,
        role: 'TENANT_ADMIN',
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const mockConfigService = {
        get: jest.fn().mockImplementation((key: string) => {
          if (key === 'auth.jwtExpiresIn') return '30m';
          if (key === 'auth.jwtRefreshExpiresIn') return '7d';
          return undefined;
        }),
      } as unknown as ConfigService;
      const nonDefaultDurationHandler = new LoginHandler(
        mockUserRepo,
        mockRefreshTokenRepo,
        mockJwtService,
        mockConfigService,
      );
      mockUserRepo.findByEmail.mockResolvedValue(user);
      mockUserRepo.save.mockResolvedValue(undefined);
      mockRefreshTokenRepo.save.mockResolvedValue(undefined);

      const result = await nonDefaultDurationHandler.execute({
        tenantId: 'tenant-id-1',
        email: 'admin@test.com',
        password: 'correct-password',
      });

      expect(result.expiresIn).toBe(1800);
      expect(mockJwtService.sign).toHaveBeenCalledWith(expect.any(Object), { expiresIn: '30m' });
    });

    it('throws InvalidCredentialsException for incorrect password', async () => {
      const passwordHash = await argon2.hash('correct-password', { type: argon2.argon2id });
      const user = User.reconstruct({
        id: 'user-id-1',
        tenantId: 'tenant-id-1',
        email: 'admin@test.com',
        passwordHash,
        role: 'TENANT_ADMIN',
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      mockUserRepo.findByEmail.mockResolvedValue(user);

      await expect(
        handler.execute({
          tenantId: 'tenant-id-1',
          email: 'admin@test.com',
          password: 'wrong-password',
        }),
      ).rejects.toThrow(InvalidCredentialsException);
    });

    it('throws InvalidCredentialsException when user does not exist', async () => {
      mockUserRepo.findByEmail.mockResolvedValue(null);

      await expect(
        handler.execute({
          tenantId: 'tenant-id-1',
          email: 'nonexistent@test.com',
          password: 'any-password',
        }),
      ).rejects.toThrow(InvalidCredentialsException);
    });

    it('throws InvalidCredentialsException when user is inactive', async () => {
      const passwordHash = await argon2.hash('correct-password', { type: argon2.argon2id });
      const user = User.reconstruct({
        id: 'user-id-1',
        tenantId: 'tenant-id-1',
        email: 'inactive@test.com',
        passwordHash,
        role: 'MEMBER',
        status: 'INACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      mockUserRepo.findByEmail.mockResolvedValue(user);

      await expect(
        handler.execute({
          tenantId: 'tenant-id-1',
          email: 'inactive@test.com',
          password: 'correct-password',
        }),
      ).rejects.toThrow(InvalidCredentialsException);
    });
  });
});
