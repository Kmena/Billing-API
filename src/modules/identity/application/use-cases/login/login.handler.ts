import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { v4 as uuidv4 } from 'uuid';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { IUserRepository, USER_REPOSITORY } from '../../../domain/ports/user.repository';
import {
  IRefreshTokenRepository,
  REFRESH_TOKEN_REPOSITORY,
} from '../../../domain/ports/refresh-token.repository';
import { InvalidCredentialsException } from '../../../domain/exceptions/invalid-credentials.exception';

export interface LoginCommand {
  readonly tenantId: string;
  readonly email: string;
  readonly password: string;
}

export interface LoginResult {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number; // seconds
}

export interface JwtPayload {
  sub: string;
  tenantId: string;
  role: string;
  jti: string;
}

@Injectable()
export class LoginHandler {
  private readonly jwtExpiresIn: string;
  private readonly refreshExpiresInDays: number;

  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: IUserRepository,
    @Inject(REFRESH_TOKEN_REPOSITORY)
    private readonly refreshTokenRepository: IRefreshTokenRepository,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    this.jwtExpiresIn = this.configService.get<string>('auth.jwtExpiresIn') ?? '15m';
    const refreshExp = this.configService.get<string>('auth.jwtRefreshExpiresIn') ?? '7d';
    this.refreshExpiresInDays = parseInt(refreshExp.replace('d', ''), 10) || 7;
  }

  async execute(command: LoginCommand): Promise<LoginResult> {
    const user = await this.userRepository.findByEmail(command.tenantId, command.email);

    // BR-004 + AC-004: Generic 401 — never reveal whether email exists
    if (!user) {
      throw new InvalidCredentialsException();
    }

    if (!user.isActive) {
      throw new InvalidCredentialsException();
    }

    const isPasswordValid = await argon2.verify(user.passwordHash, command.password);
    if (!isPasswordValid) {
      throw new InvalidCredentialsException();
    }

    user.recordLogin();
    await this.userRepository.save(user);

    // Generate access token (15 minutes)
    const jti = uuidv4();
    const payload: JwtPayload = {
      sub: user.id,
      tenantId: user.tenantId,
      role: user.role,
      jti,
    };

    const accessToken = this.jwtService.sign(payload, { expiresIn: this.jwtExpiresIn });

    // Generate refresh token, rotated on each use
    const refreshTokenRaw = crypto.randomBytes(48).toString('hex');
    const refreshTokenHash = crypto.createHash('sha256').update(refreshTokenRaw).digest('hex');

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + this.refreshExpiresInDays);

    await this.refreshTokenRepository.save({
      tokenHash: refreshTokenHash,
      userId: user.id,
      tenantId: user.tenantId,
      expiresAt,
      used: false,
    });

    return {
      accessToken,
      refreshToken: refreshTokenRaw,
      expiresIn: 15 * 60,
    };
  }
}
