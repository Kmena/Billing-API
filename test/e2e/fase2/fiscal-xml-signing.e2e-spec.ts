import * as request from 'supertest';
import { createHash, randomUUID } from 'crypto';
import {
  authorizeApiKeyForCompany,
  configureDefaultFiscalSetup,
  configureValidCompanyFiscalProfile,
  createEnabledHaciendaConnection,
  createFiscalApiKey,
  createFiscalE2eApp,
  createFiscalTenantFixture,
  fiscalInvoicePayload,
  fiscalTicketPayload,
  resetFiscalE2eData,
  validCompanyFiscalProfilePayload,
  type FiscalE2eContext,
} from '../../helpers/fiscal-e2e-helpers';
import {
  SECRET_PROVIDER,
  SecretProvider,
} from '../../../src/infrastructure/secrets/ports/secret-provider.port';
import { STORAGE_PORT, StoragePort } from '../../../src/infrastructure/storage/ports/storage.port';
import {
  XML_SIGNER,
  XmlSignerPort,
} from '../../../src/infrastructure/signing/ports/xml-signer.port';
import {
  XSD_VALIDATOR,
  XsdValidatorPort,
} from '../../../src/modules/fiscal-documents/application/fiscal-xml/xsd-validator.port';
import {
  createFiscalXmlSnapshot,
  createTestSigningMaterial,
} from '../../../src/modules/fiscal-documents/domain/fiscal-xml/__tests__/fiscal-xml-test-fixtures';

const signingMaterial = createTestSigningMaterial();

async function configureSigningCertificate(
  context: FiscalE2eContext,
  tenantId: string,
  companyId: string,
) {
  const certificateSecretReference = `FISCAL_E2E_CERT_${companyId.replace(/-/g, '_')}`;
  const passwordSecretReference = `FISCAL_E2E_PASS_${companyId.replace(/-/g, '_')}`;
  const secrets = context.app.get<SecretProvider>(SECRET_PROVIDER);
  await secrets.storeSecret(
    certificateSecretReference,
    JSON.stringify({ pkcs12Base64: signingMaterial.pkcs12Base64 }),
  );
  await secrets.storeSecret(passwordSecretReference, signingMaterial.certificate.passphrase);

  return context.prisma.fiscalSigningCertificate.create({
    data: {
      id: randomUUID(),
      tenantId,
      companyId,
      environment: 'SANDBOX',
      status: 'ACTIVE',
      certificateType: 'HACIENDA_CRYPTOGRAPHIC_KEY',
      certificateSecretReference,
      passwordSecretReference,
      fingerprintSha256: createHash('sha256')
        .update(Buffer.from(signingMaterial.certificateDerBase64, 'base64'))
        .digest('hex'),
      serialNumber: signingMaterial.x509SerialNumber,
      subjectName: signingMaterial.x509Subject,
      issuerName: 'CN=F2.3 Test CA',
      validFrom: new Date('2026-01-01T00:00:00.000Z'),
      validTo: new Date('2027-01-01T00:00:00.000Z'),
      activeFrom: new Date('2026-01-01T00:00:00.000Z'),
    },
  });
}

async function createReadyForXmlDocument(
  context: FiscalE2eContext,
  input: {
    tenantId: string;
    companyId: string;
    type: 'INVOICE' | 'TICKET';
  },
): Promise<string> {
  const snapshot = createFiscalXmlSnapshot(input.type);
  const issuancePoint = await context.prisma.fiscalIssuancePoint.findFirstOrThrow({
    where: {
      tenantId: input.tenantId,
      companyId: input.companyId,
      environment: 'SANDBOX',
      isDefault: true,
    },
  });
  const sequenceValue = input.type === 'INVOICE' ? 1n : 2n;
  const consecutive = input.type === 'INVOICE' ? '00100001010000000001' : '00100001040000000002';
  const document = await context.prisma.fiscalDocument.create({
    data: {
      id: randomUUID(),
      tenantId: input.tenantId,
      companyId: input.companyId,
      environment: 'SANDBOX',
      type: input.type,
      status: 'READY_FOR_XML',
      issuancePointId: issuancePoint.id,
      branchCode: issuancePoint.branchCode,
      terminalCode: issuancePoint.terminalCode,
      sequenceValue,
      consecutive,
      clave:
        input.type === 'INVOICE'
          ? '50612092600310100000000100001010000000001123456789'
          : '50612092600310100000000100001040000000002123456789',
      securityCode: '12345678',
      issueDate: snapshot.issueDate,
      issuerSnapshot: snapshot.issuerSnapshot as never,
      receiverSnapshot: snapshot.receiverSnapshot as never,
      currency: snapshot.currency,
      exchangeRate: snapshot.exchangeRate?.toString() ?? null,
      saleCondition: snapshot.saleCondition,
      paymentMethod: snapshot.paymentMethod,
      lines: snapshot.lines as never,
      totals: snapshot.totals as never,
    },
  });

  return document.id;
}

async function expectPreparedSignedXml(
  context: FiscalE2eContext,
  input: { apiKeySecret: string; fiscalDocumentId: string; expectedType: 'INVOICE' | 'TICKET' },
): Promise<void> {
  const response = await request(context.app.getHttpServer())
    .post(`/api/v1/fiscal-documents/${input.fiscalDocumentId}/prepare-xml`)
    .set('X-API-Key', input.apiKeySecret)
    .expect(201);

  expect(response.body.status).toBe('READY_TO_SUBMIT');
  expect(response.body.signedXmlSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(response.body.unsignedXmlSha256).toMatch(/^[a-f0-9]{64}$/);

  const artifact = await context.prisma.fiscalXmlArtifact.findUniqueOrThrow({
    where: { id: response.body.artifactId },
  });
  const storage = context.app.get<StoragePort>(STORAGE_PORT);
  const signer = context.app.get<XmlSignerPort>(XML_SIGNER);
  const validator = context.app.get<XsdValidatorPort>(XSD_VALIDATOR);
  const signedBytes = await storage.download(artifact.signedXmlStorageKey ?? '');
  const signedXml = signedBytes.toString('utf8');
  const verification = await signer.verify(signedXml);
  const validation = validator.validate({
    xml: signedXml,
    rootElement: input.expectedType === 'INVOICE' ? 'FacturaElectronica' : 'TiqueteElectronico',
    schemaVersion: '4.4',
    documentType: input.expectedType,
    namespace: 'https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/',
  });

  expect(createHash('sha256').update(signedBytes).digest('hex')).toBe(artifact.signedXmlSha256);
  expect(artifact.signedXmlSha256).toBe(response.body.signedXmlSha256);
  expect(artifact.xsdValidationStatus).toBe('VALID');
  expect(artifact.signedXmlStorageKey).toContain('/signed.xml');
  expect(signedXml).toContain('<ds:Signature');
  expect(verification.isValid).toBe(true);
  expect(validation).toMatchObject({ isValid: true, errors: [] });

  const retryResponse = await request(context.app.getHttpServer())
    .post(`/api/v1/fiscal-documents/${input.fiscalDocumentId}/prepare-xml`)
    .set('X-API-Key', input.apiKeySecret)
    .expect(201);
  expect(retryResponse.body.artifactId).toBe(response.body.artifactId);
  expect(retryResponse.body.signedXmlSha256).toBe(response.body.signedXmlSha256);
}

describe('Fiscal XML signing prepare flow (E2E)', () => {
  let context: FiscalE2eContext;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    context = await createFiscalE2eApp();
    await resetFiscalE2eData(context.prisma);
  });

  afterAll(async () => {
    await resetFiscalE2eData(context.prisma);
    await context?.prisma.$disconnect();
    await context?.app.close();
  });

  it('uses the immutable F2.2 issuer snapshot when profile changes before prepare XML', async () => {
    const fixture = await createFiscalTenantFixture(context);
    await createEnabledHaciendaConnection(context.prisma, fixture.tenantId, fixture.companyId);
    await configureValidCompanyFiscalProfile(context, fixture);
    await configureDefaultFiscalSetup(context, fixture, 'INVOICE');
    await configureSigningCertificate(context, fixture.tenantId, fixture.companyId);
    const apiKey = await createFiscalApiKey(context.prisma, fixture.tenantId, ['invoices:write']);
    await authorizeApiKeyForCompany(context.prisma, apiKey.id, fixture.companyId);

    const created = await request(context.app.getHttpServer())
      .post('/api/v1/invoices')
      .set('X-API-Key', apiKey.secret)
      .set('Idempotency-Key', 'profile-a-create')
      .send(fiscalInvoicePayload(fixture.companyId))
      .expect(201);

    const profileB = {
      ...validCompanyFiscalProfilePayload(),
      economicActivityCode: '722001',
      province: '2',
      canton: '02',
      district: '03',
      barrio: 'Merced',
      otrasSenas: 'Perfil fiscal B posterior a la creación del comprobante',
      email: 'perfil-b@example.co.cr',
    };
    await request(context.app.getHttpServer())
      .put(`/api/v1/companies/${fixture.companyId}/fiscal-profile`)
      .set('Authorization', `Bearer ${fixture.jwtToken}`)
      .send(profileB)
      .expect(200);

    const prepared = await request(context.app.getHttpServer())
      .post(`/api/v1/fiscal-documents/${created.body.id}/prepare-xml`)
      .set('X-API-Key', apiKey.secret)
      .expect(201);

    const artifact = await context.prisma.fiscalXmlArtifact.findUniqueOrThrow({
      where: { id: prepared.body.artifactId },
    });
    const storage = context.app.get<StoragePort>(STORAGE_PORT);
    const signedXml = (await storage.download(artifact.signedXmlStorageKey ?? '')).toString('utf8');

    expect(signedXml).toContain('<CodigoActividadEmisor>620210</CodigoActividadEmisor>');
    expect(signedXml).toContain('<Provincia>1</Provincia>');
    expect(signedXml).toContain('<Canton>01</Canton>');
    expect(signedXml).toContain('<Distrito>01</Distrito>');
    expect(signedXml).toContain(
      '<OtrasSenas>Avenida central, edificio fiscal, segundo piso</OtrasSenas>',
    );
    expect(signedXml).toContain('<CorreoElectronico>facturacion@example.co.cr</CorreoElectronico>');
    expect(signedXml).not.toContain('722001');
    expect(signedXml).not.toContain('perfil-b@example.co.cr');
  });

  it('prepares normal API-created FE and TE documents to READY_TO_SUBMIT with XMLDSig and XSD pass', async () => {
    const fixture = await createFiscalTenantFixture(context);
    await createEnabledHaciendaConnection(context.prisma, fixture.tenantId, fixture.companyId);
    await configureValidCompanyFiscalProfile(context, fixture);
    await configureDefaultFiscalSetup(context, fixture, 'INVOICE');
    await configureDefaultFiscalSetup(context, fixture, 'TICKET');
    await configureSigningCertificate(context, fixture.tenantId, fixture.companyId);
    const apiKey = await createFiscalApiKey(context.prisma, fixture.tenantId, [
      'invoices:write',
      'tickets:write',
    ]);
    await authorizeApiKeyForCompany(context.prisma, apiKey.id, fixture.companyId);

    const invoice = await request(context.app.getHttpServer())
      .post('/api/v1/invoices')
      .set('X-API-Key', apiKey.secret)
      .set('Idempotency-Key', 'normal-fe-ready-to-submit')
      .send(fiscalInvoicePayload(fixture.companyId))
      .expect(201);
    const ticket = await request(context.app.getHttpServer())
      .post('/api/v1/tickets')
      .set('X-API-Key', apiKey.secret)
      .set('Idempotency-Key', 'normal-te-ready-to-submit')
      .send(fiscalTicketPayload(fixture.companyId))
      .expect(201);

    await expectPreparedSignedXml(context, {
      apiKeySecret: apiKey.secret,
      fiscalDocumentId: invoice.body.id,
      expectedType: 'INVOICE',
    });
    await expectPreparedSignedXml(context, {
      apiKeySecret: apiKey.secret,
      fiscalDocumentId: ticket.body.id,
      expectedType: 'TICKET',
    });
  });

  it('prepares signed FE and TE XML to READY_TO_SUBMIT without submitting to Hacienda', async () => {
    const fixture = await createFiscalTenantFixture(context);
    await createEnabledHaciendaConnection(context.prisma, fixture.tenantId, fixture.companyId);
    await configureDefaultFiscalSetup(context, fixture, 'INVOICE');
    await configureDefaultFiscalSetup(context, fixture, 'TICKET');
    await configureSigningCertificate(context, fixture.tenantId, fixture.companyId);
    const apiKey = await createFiscalApiKey(context.prisma, fixture.tenantId, [
      'invoices:write',
      'tickets:write',
    ]);
    await authorizeApiKeyForCompany(context.prisma, apiKey.id, fixture.companyId);

    const invoiceId = await createReadyForXmlDocument(context, {
      tenantId: fixture.tenantId,
      companyId: fixture.companyId,
      type: 'INVOICE',
    });
    const ticketId = await createReadyForXmlDocument(context, {
      tenantId: fixture.tenantId,
      companyId: fixture.companyId,
      type: 'TICKET',
    });

    await expectPreparedSignedXml(context, {
      apiKeySecret: apiKey.secret,
      fiscalDocumentId: invoiceId,
      expectedType: 'INVOICE',
    });
    await expectPreparedSignedXml(context, {
      apiKeySecret: apiKey.secret,
      fiscalDocumentId: ticketId,
      expectedType: 'TICKET',
    });
  });
});
