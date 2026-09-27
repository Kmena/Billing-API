import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateCompanyRequestDto } from '../create-company.request.dto';

describe('CreateCompanyRequestDto', () => {
  it('rejects CPF-formatted certificate identity as Company.identificationNumber', async () => {
    const dto = plainToInstance(CreateCompanyRequestDto, {
      legalName: 'Sandbox Persona Fisica',
      identificationType: 'FISICA',
      identificationNumber: 'CPF-02-0753-0251',
    });

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'identificationNumber')).toBe(true);
  });

  it('accepts canonical numeric FISICA identification', async () => {
    const dto = plainToInstance(CreateCompanyRequestDto, {
      legalName: 'Sandbox Persona Fisica',
      identificationType: 'FISICA',
      identificationNumber: '207530251',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });
});
