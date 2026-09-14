import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes, randomUUID } from 'crypto';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { GlobalExceptionFilter } from '../../src/api/filters/global-exception.filter';
import { CorrelationIdInterceptor } from '../../src/api/interceptors/correlation-id.interceptor';
import { TenantContextInterceptor } from '../../src/api/interceptors/tenant-context.interceptor';
import { createTestCompany, createTestTenant, createTestUser } from './test-factories';

export interface FiscalE2eContext {
  readonly app: INestApplication;
  readonly prisma: PrismaClient;
}

export interface FiscalTenantFixture {
  readonly tenantId: string;
  readonly userId: string;
  readonly jwtToken: string;
  readonly companyId: string;
  readonly companyIdentification: string;
}

export interface FiscalApiKeyFixture {
  readonly id: string;
  readonly secret: string;
  readonly keyPrefix: string;
}

export async function createFiscalE2eApp(): Promise<FiscalE2eContext> {
  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = module.createNestApplication();
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/ready', 'health/live'] });
  app.useGlobalFilters(new GlobalExceptionFilter('test'));
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalInterceptors(app.get(CorrelationIdInterceptor), app.get(TenantContextInterceptor));
  await app.init();

  return { app, prisma: new PrismaClient() };
}

export function assertSafeTestDatabaseUrl(databaseUrl = process.env.DATABASE_URL): string {
  if (!databaseUrl) throw new Error('DATABASE_URL is required for fiscal E2E tests.');
  const parsed = new URL(databaseUrl);
  const databaseName = parsed.pathname.replace(/^\//, '').toLowerCase();
  const isSafeDatabase = databaseName.includes('test') || databaseName.includes('e2e');
  const nodeEnv = process.env.NODE_ENV;

  if (nodeEnv !== 'test' || !isSafeDatabase) {
    throw new Error(
      `Refusing to reset non-test database. NODE_ENV=${nodeEnv}; database=${databaseName}`,
    );
  }

  return databaseName;
}

export async function resetFiscalE2eData(prisma: PrismaClient): Promise<void> {
  assertSafeTestDatabaseUrl();
  await prisma.fiscalXmlArtifact.deleteMany();
  await prisma.fiscalSigningCertificate.deleteMany();
  await prisma.companyFiscalProfile.deleteMany();
  await prisma.fiscalIdempotencyKey.deleteMany();
  await prisma.fiscalDocument.deleteMany();
  await prisma.fiscalSequence.deleteMany();
  await prisma.fiscalIssuancePoint.deleteMany();
  await prisma.haciendaConnection.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.apiKeyCompany.deleteMany();
  await prisma.apiKey.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
  await prisma.company.deleteMany();
  await prisma.tenant.deleteMany();
}

export async function createFiscalTenantFixture(
  context: FiscalE2eContext,
): Promise<FiscalTenantFixture> {
  const tenant = await createTestTenant(context.prisma);
  const user = await createTestUser(context.prisma, tenant.id, {
    email: `fiscal-${randomUUID()}@example.com`,
    password: 'SecurePass123!',
  });
  const company = await createTestCompany(context.prisma, tenant.id);
  const loginResponse = await request(context.app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ tenantId: tenant.id, email: user.email, password: user.password })
    .expect(200);

  return {
    tenantId: tenant.id,
    userId: user.id,
    jwtToken: loginResponse.body.accessToken as string,
    companyId: company.id,
    companyIdentification: company.identificationNumber,
  };
}

export async function createFiscalApiKey(
  prisma: PrismaClient,
  tenantId: string,
  scopes: string[],
  status: 'ACTIVE' | 'REVOKED' = 'ACTIVE',
): Promise<FiscalApiKeyFixture> {
  const keyPrefix = randomBytes(4).toString('hex');
  const secret = `bk_test_${keyPrefix}_${randomBytes(16).toString('hex')}`;
  const keyHash = await argon2.hash(secret, { type: argon2.argon2id });
  const id = randomUUID();

  await prisma.apiKey.create({
    data: {
      id,
      tenantId,
      name: `Fiscal E2E ${keyPrefix}`,
      environment: 'TEST',
      keyPrefix,
      keyHash,
      scopes,
      status,
      revokedAt: status === 'REVOKED' ? new Date() : undefined,
    },
  });

  return { id, secret, keyPrefix };
}

export async function authorizeApiKeyForCompany(
  prisma: PrismaClient,
  apiKeyId: string,
  companyId: string,
): Promise<void> {
  await prisma.apiKeyCompany.create({ data: { apiKeyId, companyId } });
}

export async function createEnabledHaciendaConnection(
  prisma: PrismaClient,
  tenantId: string,
  companyId: string,
  environment: 'SANDBOX' | 'PRODUCTION' = 'SANDBOX',
  status: 'PENDING_VALIDATION' | 'CONNECTED' | 'DISABLED' = 'CONNECTED',
): Promise<void> {
  await prisma.haciendaConnection.create({
    data: {
      id: randomUUID(),
      tenantId,
      companyId,
      environment,
      status,
      secretReference: `test-secret-${randomUUID()}`,
    },
  });
}

export async function configureValidCompanyFiscalProfile(
  context: FiscalE2eContext,
  fixture: FiscalTenantFixture,
): Promise<void> {
  await request(context.app.getHttpServer())
    .put(`/api/v1/companies/${fixture.companyId}/fiscal-profile`)
    .set('Authorization', `Bearer ${fixture.jwtToken}`)
    .send(validCompanyFiscalProfilePayload())
    .expect(200);
}

export function validCompanyFiscalProfilePayload() {
  return {
    economicActivityCode: '620210',
    proveedorSistemas: '3101234567',
    province: '1',
    canton: '01',
    district: '01',
    barrio: 'Carmen',
    otrasSenas: 'Avenida central, edificio fiscal, segundo piso',
    email: 'facturacion@example.co.cr',
    phoneCountryCode: '506',
    phoneNumber: '22223333',
  };
}

export async function configureDefaultFiscalSetup(
  context: FiscalE2eContext,
  fixture: FiscalTenantFixture,
  documentType: 'INVOICE' | 'TICKET',
  environment: 'SANDBOX' | 'PRODUCTION' = 'SANDBOX',
  nextValue = '1',
): Promise<void> {
  await request(context.app.getHttpServer())
    .put(`/api/v1/companies/${fixture.companyId}/fiscal/${environment}/issuance-points/default`)
    .set('Authorization', `Bearer ${fixture.jwtToken}`)
    .send({ name: `Default ${environment}` })
    .expect(200);

  await request(context.app.getHttpServer())
    .put(`/api/v1/companies/${fixture.companyId}/fiscal/${environment}/sequences/${documentType}`)
    .set('Authorization', `Bearer ${fixture.jwtToken}`)
    .send({ nextValue })
    .expect(200);
}

export function fiscalInvoicePayload(
  companyId: string,
  environment: 'SANDBOX' | 'PRODUCTION' = 'SANDBOX',
) {
  return {
    companyId,
    environment,
    receiver: {
      name: 'Receiver SA',
      identificationType: 'JURIDICA',
      identificationNumber: '3101000001',
      email: 'receptor@example.co.cr',
    },
    currency: 'CRC',
    saleCondition: '01',
    paymentMethod: '01',
    lines: [
      {
        lineNumber: 1,
        cabysCode: '1234567890123',
        description: 'Fiscal service',
        unitMeasure: 'Sp',
        quantity: '1.00000',
        unitPrice: '1000.00000',
        taxAmount: '130.00000',
        taxCode: '01',
        taxRateCode: '08',
        taxRate: '13.00000',
      },
    ],
  };
}

export function fiscalTicketPayload(
  companyId: string,
  environment: 'SANDBOX' | 'PRODUCTION' = 'SANDBOX',
) {
  return {
    companyId,
    environment,
    currency: 'CRC',
    saleCondition: '01',
    paymentMethod: '01',
    lines: [
      {
        lineNumber: 1,
        cabysCode: '1234567890123',
        description: 'Fiscal ticket item',
        unitMeasure: 'Unid',
        quantity: '2.00000',
        unitPrice: '500.00000',
        taxAmount: '130.00000',
        taxCode: '01',
        taxRateCode: '08',
        taxRate: '13.00000',
      },
    ],
  };
}

export function expectSanitizedFiscalResponse(body: unknown): void {
  const serialized = JSON.stringify(body);
  expect(serialized).not.toContain('securityCode');
  expect(serialized).not.toContain('requestHash');
}
