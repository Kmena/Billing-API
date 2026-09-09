import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length } from 'class-validator';

export class LoginRequestDto {
  @ApiProperty({ example: 'admin@company.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'securepassword123' })
  @IsString()
  @Length(8, 128)
  password!: string;

  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'The tenant ID to authenticate against',
  })
  @IsString()
  tenantId!: string;
}
