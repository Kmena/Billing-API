import { registerAs } from '@nestjs/config';

export interface AuthConfig {
  jwtSecret: string;
  jwtExpiresIn: string;
  jwtRefreshExpiresIn: string;
}

export default registerAs('auth', (): AuthConfig => ({
  jwtSecret: process.env.JWT_SECRET ?? 'dev-insecure-jwt-secret-change-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '15m',
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
}));
