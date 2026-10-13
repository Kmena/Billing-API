import { existsSync } from 'fs';
import { randomUUID } from 'crypto';
import { resolve } from 'path';
import {
  createFiscalApiKey,
  createFiscalE2eApp,
  createFiscalTenantFixture,
  resetFiscalE2eData,
  type FiscalE2eContext,
} from '../../helpers/fiscal-e2e-helpers';
import {
  INVENTORI_BOOTSTRAP_PROFILE,
  INVENTORI_BOOTSTRAP_V1_SCOPES,
} from '../../../src/modules/fiscal-onboarding/domain/inventori-fiscal-profile';
import { createTestSigningMaterialWithFiscalId } from '../../../src/modules/fiscal-documents/domain/fiscal-xml/__tests__/fiscal-xml-test-fixtures';
import {
  SECRET_PROVIDER,
  type SecretProvider,
} from '../../../src/infrastructure/secrets/ports/secret-provider.port';

type Address = { port: number } | string | null;

const TEST_INVOICE = {
  mode: 'HACIENDA_SANDBOX_SUBMISSION',
  confirmation: 'CONSUME_SANDBOX_CONSECUTIVE',
  receiver: {
    name: 'Wave 8 Synthetic Receiver',
    identificationType: 'JURIDICA',
    identificationNumber: '3101000001',
    email: 'receiver@example.invalid',
  },
  currency: 'CRC',
  saleCondition: '01',
  paymentMethod: '01',
  lines: [
    {
      lineNumber: 1,
      cabysCode: '1234567890123',
      description: 'Wave 8 synthetic sandbox service',
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

describe('Wave 8 Inventori to Billing integrated onboarding — disposable PostgreSQL', () => {
  let context: FiscalE2eContext;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.USE_REAL_HACIENDA = 'false';
    context = await createFiscalE2eApp();
    await context.app.listen(0, '127.0.0.1');
    const address = context.app.getHttpServer().address() as Address;
    if (!address || typeof address === 'string')
      throw new Error('Billing test server did not bind');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(async () => resetFiscalE2eData(context));

  afterAll(async () => {
    await resetFiscalE2eData(context);
    await context.app.close();
  });

  it('uses the real Inventori client for bootstrap recovery, configuration, readiness, one SANDBOX identity and credential rotation', async () => {
    const fixture = await createFiscalTenantFixture(context);
    const bootstrapKey = await createFiscalApiKey(
      context.prisma,
      fixture.tenantId,
      [...INVENTORI_BOOTSTRAP_V1_SCOPES],
      'ACTIVE',
      'TEST',
      INVENTORI_BOOTSTRAP_PROFILE,
    );
    const clientPath =
      process.env.INVENTORI_BILLING_CLIENT_PATH ??
      resolve(
        process.cwd(),
        '..',
        'inventory-api',
        'inventory-api',
        'src',
        'services',
        'billing-api-client.service.js',
      );
    expect(existsSync(clientPath)).toBe(true);
    // This is deliberately the production Inventori HTTP client, not a test double.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { BillingApiClient } = require(clientPath);
    const credentials = new Map<string, string>([['bootstrap', bootstrapKey.secret]]);
    const networkUrls: string[] = [];
    let dropBootstrapResponse = true;
    const localFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      networkUrls.push(url);
      expect(new URL(url).origin).toBe(baseUrl);
      const response = await fetch(input, init);
      if (dropBootstrapResponse && url.endsWith('/api/v1/fiscal-onboarding/v1/bootstrap')) {
        dropBootstrapResponse = false;
        await response.arrayBuffer();
        throw new Error('synthetic lost bootstrap response');
      }
      return response;
    };
    const client = new BillingApiClient({
      baseUrl,
      timeoutMs: 15_000,
      fetchImpl: localFetch,
      credentialResolver: {
        resolveApiKey(reference: string) {
          const value = credentials.get(reference);
          if (!value) throw new Error(`Missing synthetic credential reference: ${reference}`);
          return value;
        },
      },
    });
    const bootstrapPayload = {
      externalCompanyKey: `inventori:wave8:${fixture.companyId}`,
      existingCompanyId: fixture.companyId,
      legalName: 'Wave 8 Synthetic Fiscal Issuer',
      identificationType: 'JURIDICA',
      identificationNumber: fixture.companyIdentification,
      environment: 'SANDBOX',
    };

    await expect(
      client.bootstrapFiscalIssuer({
        secretReference: 'bootstrap',
        correlationId: randomUUID(),
        payload: bootstrapPayload,
      }),
    ).rejects.toMatchObject({ code: 'BILLING_UNAVAILABLE', retryable: true });

    const bootstrap = await client.bootstrapFiscalIssuer({
      secretReference: 'bootstrap',
      correlationId: randomUUID(),
      payload: bootstrapPayload,
    });
    expect(bootstrap.association.company.id).toBe(fixture.companyId);
    expect(bootstrap.credential.returnedOnce).toBe(true);
    credentials.set('operational', bootstrap.credential.secret);
    const operationalSecret = bootstrap.credential.secret;

    await expect(
      client.getFiscalIssuerV1({
        billingCompanyId: fixture.companyId,
        environment: 'SANDBOX',
        secretReference: 'operational',
        correlationId: randomUUID(),
      }),
    ).resolves.toMatchObject({ company: { id: fixture.companyId } });

    await client.upsertFiscalProfileV1({
      billingCompanyId: fixture.companyId,
      environment: 'SANDBOX',
      secretReference: 'operational',
      correlationId: randomUUID(),
      payload: {
        economicActivityCode: '620210',
        proveedorSistemas: '3101234567',
        province: '1',
        canton: '01',
        district: '01',
        barrio: 'Carmen',
        otrasSenas: 'Dirección fiscal sintética Wave 8',
        email: 'fiscal@example.invalid',
        phoneCountryCode: '506',
        phoneNumber: '22223333',
      },
    });
    const verifiedAt = new Date();
    const activity = await context.prisma.companyEconomicActivity.create({
      data: {
        id: randomUUID(),
        tenantId: fixture.tenantId,
        companyId: fixture.companyId,
        code: '620210',
        description: 'Wave 8 mock Hacienda verified activity',
        haciendaStatus: 'A',
        haciendaKind: 'P',
        billingEnabled: true,
        verifiedAt,
        lastSeenAt: verifiedAt,
        verificationSource: 'HACIENDA_FE_AE',
      },
    });
    await context.prisma.$transaction([
      context.prisma.company.update({
        where: { id: fixture.companyId },
        data: {
          haciendaVerificationStatus: 'VERIFIED',
          haciendaVerifiedAt: verifiedAt,
          haciendaTaxSituation: 'Inscrito',
          haciendaMoroso: false,
          haciendaOmiso: false,
        },
      }),
      context.prisma.companyFiscalProfile.update({
        where: { companyId: fixture.companyId },
        data: { defaultEconomicActivityId: activity.id },
      }),
    ]);

    await client.replaceHaciendaCredentialsV1({
      billingCompanyId: fixture.companyId,
      environment: 'SANDBOX',
      username: 'wave8-synthetic-user',
      password: 'wave8-write-only-password',
      secretReference: 'operational',
      correlationId: randomUUID(),
    });
    await expect(
      client.validateHaciendaConnectionV1({
        billingCompanyId: fixture.companyId,
        environment: 'SANDBOX',
        secretReference: 'operational',
        correlationId: randomUUID(),
      }),
    ).resolves.toMatchObject({ status: 'CONNECTED' });

    const signingMaterial = createTestSigningMaterialWithFiscalId(
      `CPJ-${fixture.companyIdentification}`,
      'wave8-synthetic-pin',
    );
    // The disposable app intentionally uses the isolated in-memory secret adapter.
    // Mark this test instance as the durable test seam so the production guard is
    // exercised without reaching AWS/LocalStack or weakening runtime behavior.
    const isolatedSecrets = context.app.get<SecretProvider>(SECRET_PROVIDER);
    Object.defineProperty(isolatedSecrets, 'isDurable', { value: true });
    const certificate = await client.writeSigningCertificate({
      billingCompanyId: fixture.companyId,
      environment: 'SANDBOX',
      certificateBytes: signingMaterial.pkcs12Bytes,
      pin: signingMaterial.passphrase,
      replace: false,
      secretReference: 'operational',
      correlationId: randomUUID(),
    });
    expect(certificate).toMatchObject({
      status: 'ACTIVE',
      extractedIdentityNumber: fixture.companyIdentification,
    });

    const branch = await client.upsertFiscalBranchV1({
      billingCompanyId: fixture.companyId,
      environment: 'SANDBOX',
      payload: { code: '001', name: 'Wave 8 Principal' },
      secretReference: 'operational',
      correlationId: randomUUID(),
    });
    const terminal = await client.upsertFiscalTerminalV1({
      billingCompanyId: fixture.companyId,
      environment: 'SANDBOX',
      branchId: branch.id,
      payload: { code: '00001', name: 'Wave 8 Caja 1' },
      secretReference: 'operational',
      correlationId: randomUUID(),
    });
    await client.selectDefaultIssuancePointV1({
      billingCompanyId: fixture.companyId,
      environment: 'SANDBOX',
      terminalId: terminal.id,
      secretReference: 'operational',
      correlationId: randomUUID(),
    });
    await client.configureInitialSequenceV1({
      billingCompanyId: fixture.companyId,
      environment: 'SANDBOX',
      terminalId: terminal.id,
      documentType: 'INVOICE',
      nextValue: 1,
      secretReference: 'operational',
      correlationId: randomUUID(),
    });

    await expect(
      client.getFiscalReadinessV1({
        billingCompanyId: fixture.companyId,
        environment: 'SANDBOX',
        secretReference: 'operational',
        correlationId: randomUUID(),
      }),
    ).resolves.toMatchObject({ readyToIssue: true, status: 'READY' });

    const beforeFailure = await context.prisma.fiscalSequence.findFirstOrThrow({
      where: { tenantId: fixture.tenantId, companyId: fixture.companyId, environment: 'SANDBOX' },
    });
    await expect(
      client.initiateFiscalTestInvoiceV1({
        billingCompanyId: fixture.companyId,
        environment: 'SANDBOX',
        secretReference: 'operational',
        correlationId: randomUUID(),
        idempotencyKey: randomUUID(),
        payload: { ...TEST_INVOICE, confirmation: 'INVALID_CONFIRMATION' },
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      context.prisma.fiscalSequence.findUniqueOrThrow({ where: { id: beforeFailure.id } }),
    ).resolves.toMatchObject({ nextValue: beforeFailure.nextValue, lastAssigned: null });

    const idempotencyKey = randomUUID();
    const [initiated, replay] = await Promise.all([
      client.initiateFiscalTestInvoiceV1({
        billingCompanyId: fixture.companyId,
        environment: 'SANDBOX',
        secretReference: 'operational',
        correlationId: randomUUID(),
        idempotencyKey,
        payload: TEST_INVOICE,
      }),
      client.initiateFiscalTestInvoiceV1({
        billingCompanyId: fixture.companyId,
        environment: 'SANDBOX',
        secretReference: 'operational',
        correlationId: randomUUID(),
        idempotencyKey,
        payload: TEST_INVOICE,
      }),
    ]);
    expect(replay.executionId).toBe(initiated.executionId);
    const status = await client.getFiscalTestInvoiceV1({
      billingCompanyId: fixture.companyId,
      environment: 'SANDBOX',
      secretReference: 'operational',
      correlationId: randomUUID(),
      executionId: initiated.executionId,
    });
    expect(status).toMatchObject({
      executionId: initiated.executionId,
      environment: 'SANDBOX',
      disclosure: {
        consumesSandboxConsecutive: true,
        billingRequestAcceptedIsNotHaciendaAcceptance: true,
      },
      submission: { status: 'ACCEPTED', haciendaAccepted: true },
      xmlProcessing: { generatedXmlAvailable: true, signedXmlAvailable: true },
    });
    expect(status.artifacts.length).toBeGreaterThan(0);
    expect(
      await context.prisma.fiscalDocument.count({ where: { tenantId: fixture.tenantId } }),
    ).toBe(1);
    await expect(
      context.prisma.fiscalSequence.findUniqueOrThrow({ where: { id: beforeFailure.id } }),
    ).resolves.toMatchObject({ nextValue: 2n, lastAssigned: 1n });

    const rotated = await client.bootstrapFiscalIssuer({
      secretReference: 'bootstrap',
      correlationId: randomUUID(),
      payload: bootstrapPayload,
    });
    credentials.set('operational', rotated.credential.secret);
    expect(rotated.credential.secret).not.toBe(operationalSecret);
    await expect(
      client.getFiscalTestInvoiceV1({
        billingCompanyId: fixture.companyId,
        environment: 'SANDBOX',
        secretReference: 'operational',
        correlationId: randomUUID(),
        executionId: initiated.executionId,
      }),
    ).resolves.toMatchObject({ executionId: initiated.executionId });
    credentials.set('retired', operationalSecret);
    await expect(
      client.getFiscalIssuerV1({
        billingCompanyId: fixture.companyId,
        environment: 'SANDBOX',
        secretReference: 'retired',
        correlationId: randomUUID(),
      }),
    ).rejects.toMatchObject({ statusCode: 401 });

    expect(networkUrls.length).toBeGreaterThanOrEqual(18);
    expect(networkUrls.every((url) => new URL(url).origin === baseUrl)).toBe(true);
    const serializedEvidence = JSON.stringify({
      bootstrap,
      certificate,
      initiated,
      status,
      rotated,
    });
    expect(serializedEvidence).not.toContain('wave8-write-only-password');
    expect(serializedEvidence).not.toContain('wave8-synthetic-pin');
    expect(serializedEvidence).not.toContain(bootstrapKey.secret);
  });
});
