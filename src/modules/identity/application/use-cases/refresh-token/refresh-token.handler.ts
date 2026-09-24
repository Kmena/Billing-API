import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import * as crypto from 'crypto';
import { IUserRepository, USER_REPOSITORY } from '../../../domain/ports/user.repository';
import {
  IRefreshTokenRepository,
  REFRESH_TOKEN_REPOSITORY,
} from '../../../domain/ports/refresh-token.repository';
import { InvalidRefreshTokenException } from '../../../domain/exceptions/invalid-refresh-token.exception';
import type { JwtPayload } from '../login/login.handler';
import { addAuthDurationToDate, parseAuthDurationToSeconds } from '../shared/auth-token-duration';

export interface RefreshTokenCommand {
  readonly refreshToken: string;
}

export interface RefreshTokenResult {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
}

@Injectable()
export class RefreshTokenHandler {
  private readonly jwtExpiresIn: string;
  private readonly jwtRefreshExpiresIn: string;

  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: IUserRepository,
    @Inject(REFRESH_TOKEN_REPOSITORY)
    private readonly refreshTokenRepository: IRefreshTokenRepository,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    this.jwtExpiresIn = this.configService.get<string>('auth.jwtExpiresIn') ?? '15m';
    this.jwtRefreshExpiresIn = this.configService.get<string>('auth.jwtRefreshExpiresIn') ?? '7d';
  }

  async execute(command: RefreshTokenCommand): Promise<RefreshTokenResult> {
    const tokenHash = crypto.createHash('sha256').update(command.refreshToken).digest('hex');

    const record = await this.refreshTokenRepository.findByHash(tokenHash);

    if (!record) {
      throw new InvalidRefreshTokenException();
    }

    if (record.used) {
      throw new InvalidRefreshTokenException();
    }

    if (record.expiresAt < new Date()) {
      throw new InvalidRefreshTokenException();
    }

    const user = await this.userRepository.findById(record.userId);
    if (!user || !user.isActive) {
      throw new InvalidRefreshTokenException();
    }

    // Rotate: mark old token as used
    await this.refreshTokenRepository.markAsUsed(tokenHash);

    // Issue new access token
    const jti = randomUUID();
    const payload: JwtPayload = {
      sub: user.id,
      tenantId: user.tenantId,
      role: user.role,
      jti,
    };

    const accessToken = this.jwtService.sign(payload, { expiresIn: this.jwtExpiresIn });

    // Issue new refresh token (rotation)
    const newRefreshTokenRaw = crypto.randomBytes(48).toString('hex');
    const newRefreshTokenHash = crypto
      .createHash('sha256')
      .update(newRefreshTokenRaw)
      .digest('hex');

    const expiresAt = addAuthDurationToDate(new Date(), this.jwtRefreshExpiresIn);

    await this.refreshTokenRepository.save({
      tokenHash: newRefreshTokenHash,
      userId: user.id,
      tenantId: user.tenantId,
      expiresAt,
      used: false,
    });

    return {
      accessToken,
      refreshToken: newRefreshTokenRaw,
      expiresIn: parseAuthDurationToSeconds(this.jwtExpiresIn),
    };
  }
}
