import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import {
  IRefreshTokenRepository,
  RefreshTokenRecord,
} from '../../domain/ports/refresh-token.repository';

@Injectable()
export class PrismaRefreshTokenRepository implements IRefreshTokenRepository {
  constructor(private readonly prisma: PrismaService) {}

  async save(record: RefreshTokenRecord): Promise<void> {
    await this.prisma.refreshToken.create({
      data: {
        id: uuidv4(),
        userId: record.userId,
        tenantId: record.tenantId,
        tokenHash: record.tokenHash,
        used: record.used,
        expiresAt: record.expiresAt,
      },
    });
  }

  async findByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });

    if (!record) return null;

    return {
      tokenHash: record.tokenHash,
      userId: record.userId,
      tenantId: record.tenantId,
      expiresAt: record.expiresAt,
      used: record.used,
    };
  }

  async markAsUsed(tokenHash: string): Promise<void> {
    await this.prisma.refreshToken.update({
      where: { tokenHash },
      data: { used: true },
    });
  }

  async deleteByUserId(userId: string): Promise<void> {
    await this.prisma.refreshToken.deleteMany({ where: { userId } });
  }
}
