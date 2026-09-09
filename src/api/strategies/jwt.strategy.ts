import { Inject, Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import {
  SecretProvider,
  SECRET_PROVIDER,
} from '../../infrastructure/secrets/ports/secret-provider.port';
import type { JwtPayload } from '../../modules/identity/application/use-cases/login/login.handler';

export interface JwtRequest {
  userId: string;
  tenantId: string;
  role: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @Inject(SECRET_PROVIDER)
    private readonly secretProvider: SecretProvider,
  ) {
    // BR-006: JWT secret is read from SecretProvider — never from process.env directly
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKeyProvider: async (
        _request: unknown,
        _rawJwtToken: unknown,
        done: (err: Error | null, secretOrKey?: string) => void,
      ) => {
        try {
          const secret = await secretProvider.getSecret('JWT_SECRET');
          done(null, secret);
        } catch (err) {
          done(err as Error);
        }
      },
    });
  }

  validate(payload: JwtPayload): JwtRequest {
    return {
      userId: payload.sub,
      tenantId: payload.tenantId,
      role: payload.role,
    };
  }
}
