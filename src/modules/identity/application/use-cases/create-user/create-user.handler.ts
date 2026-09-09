import { Inject, Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import * as argon2 from 'argon2';
import { User, UserRole } from '../../../domain/entities/user.entity';
import { IUserRepository, USER_REPOSITORY } from '../../../domain/ports/user.repository';

export interface CreateUserCommand {
  readonly tenantId: string;
  readonly email: string;
  readonly password: string;
  readonly role?: UserRole;
  readonly firstName?: string;
  readonly lastName?: string;
}

export interface CreateUserResult {
  readonly id: string;
  readonly tenantId: string;
  readonly email: string;
  readonly role: string;
  readonly status: string;
  readonly createdAt: Date;
}

@Injectable()
export class CreateUserHandler {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: IUserRepository,
  ) {}

  async execute(command: CreateUserCommand): Promise<CreateUserResult> {
    // Hash password with argon2id — ADR-002: argon2id for all passwords
    const passwordHash = await argon2.hash(command.password, { type: argon2.argon2id });

    const user = User.create(
      uuidv4(),
      command.tenantId,
      command.email,
      passwordHash,
      command.role ?? 'MEMBER',
      command.firstName,
      command.lastName,
    );

    await this.userRepository.save(user);

    return {
      id: user.id,
      tenantId: user.tenantId,
      email: user.email,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt,
    };
  }
}
