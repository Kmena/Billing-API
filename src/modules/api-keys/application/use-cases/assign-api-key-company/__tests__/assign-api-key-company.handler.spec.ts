import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AssignApiKeyCompanyHandler } from '../assign-api-key-company.handler';
import { ApiKeyNotFoundException } from '../../../../domain/exceptions/api-key-not-found.exception';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const COMPANY_ID = '00000000-0000-0000-0000-000000000002';
const API_KEY_ID = '00000000-0000-0000-0000-000000000003';

function createPrisma(
  options: { apiKey?: object | null; company?: object | null; createError?: Error } = {},
) {
  return {
    apiKey: {
      findFirst: jest
        .fn()
        .mockResolvedValue(Object.hasOwn(options, 'apiKey') ? options.apiKey : { id: API_KEY_ID }),
    },
    company: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          Object.hasOwn(options, 'company') ? options.company : { id: COMPANY_ID },
        ),
    },
    apiKeyCompany: {
      create: options.createError
        ? jest.fn().mockRejectedValue(options.createError)
        : jest.fn().mockResolvedValue({}),
    },
  };
}

describe('AssignApiKeyCompanyHandler', () => {
  it('creates a binding only for an active key and company in the caller tenant', async () => {
    const prisma = createPrisma();
    const handler = new AssignApiKeyCompanyHandler(prisma as never);

    await expect(
      handler.execute({ tenantId: TENANT_ID, apiKeyId: API_KEY_ID, companyId: COMPANY_ID }),
    ).resolves.toEqual({ created: true });
    expect(prisma.apiKey.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: TENANT_ID, status: 'ACTIVE' }),
      }),
    );
    expect(prisma.company.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: TENANT_ID, status: 'ACTIVE' }),
      }),
    );
    expect(prisma.apiKeyCompany.create).toHaveBeenCalledWith({
      data: { apiKeyId: API_KEY_ID, companyId: COMPANY_ID },
    });
  });

  it('fails closed when the API key is absent or belongs to another tenant', async () => {
    const prisma = createPrisma({ apiKey: null });
    const handler = new AssignApiKeyCompanyHandler(prisma as never);

    await expect(
      handler.execute({ tenantId: TENANT_ID, apiKeyId: API_KEY_ID, companyId: COMPANY_ID }),
    ).rejects.toBeInstanceOf(ApiKeyNotFoundException);
    expect(prisma.company.findFirst).not.toHaveBeenCalled();
    expect(prisma.apiKeyCompany.create).not.toHaveBeenCalled();
  });

  it('fails closed when the company is absent or belongs to another tenant', async () => {
    const prisma = createPrisma({ company: null });
    const handler = new AssignApiKeyCompanyHandler(prisma as never);

    await expect(
      handler.execute({ tenantId: TENANT_ID, apiKeyId: API_KEY_ID, companyId: COMPANY_ID }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.apiKeyCompany.create).not.toHaveBeenCalled();
  });

  it('is idempotent when the exact tenant-scoped binding already exists', async () => {
    const duplicate = new Prisma.PrismaClientKnownRequestError('duplicate', {
      code: 'P2002',
      clientVersion: 'test',
    });
    const prisma = createPrisma({ createError: duplicate });
    const handler = new AssignApiKeyCompanyHandler(prisma as never);

    await expect(
      handler.execute({ tenantId: TENANT_ID, apiKeyId: API_KEY_ID, companyId: COMPANY_ID }),
    ).resolves.toEqual({ created: false });
  });
});
