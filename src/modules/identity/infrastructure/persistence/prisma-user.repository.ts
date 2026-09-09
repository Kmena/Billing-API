import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import { IUserRepository } from '../../domain/ports/user.repository';
import { User } from '../../domain/entities/user.entity';
import type { User as PrismaUser } from '@prisma/client';

@Injectable()
export class PrismaUserRepository implements IUserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<User | null> {
    const record = await this.prisma.user.findUnique({ where: { id } });
    if (!record) return null;
    return this.toDomain(record);
  }

  async findByEmail(tenantId: string, email: string): Promise<User | null> {
    const record = await this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId, email: email.toLowerCase() } },
    });
    if (!record) return null;
    return this.toDomain(record);
  }

  async save(user: User): Promise<void> {
    await this.prisma.user.upsert({
      where: { id: user.id },
      create: {
        id: user.id,
        tenantId: user.tenantId,
        email: user.email,
        passwordHash: user.passwordHash,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        status: user.status,
        lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      update: {
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        status: user.status,
        lastLoginAt: user.lastLoginAt,
        updatedAt: user.updatedAt,
      },
    });
  }

  private toDomain(record: PrismaUser): User {
    return User.reconstruct({
      id: record.id,
      tenantId: record.tenantId,
      email: record.email,
      passwordHash: record.passwordHash,
      firstName: record.firstName,
      lastName: record.lastName,
      role: record.role,
      status: record.status,
      lastLoginAt: record.lastLoginAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  }
}
