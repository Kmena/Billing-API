import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { resetFiscalE2eData } from '../../helpers/fiscal-e2e-helpers';
import { createTestCompany, createTestTenant } from '../../helpers/test-factories';

async function createReadyForXmlDocument(
  prisma: PrismaClient,
  input: { tenantId: string; companyId: string },
) {
  const issuancePointId = randomUUID();
  await prisma.fiscalIssuancePoint.create({
    data: {
      id: issuancePointId,
      tenantId: input.tenantId,
      companyId: input.companyId,
      environment: 'SANDBOX',
      branchCode: '001',
      terminalCode: '00001',
      active: true,
      isDefault: true,
    },
  });

  return prisma.fiscalDocument.create({
    data: {
      id: randomUUID(),
      tenantId: input.tenantId,
      companyId: input.companyId,
      environment: 'SANDBOX',
      type: 'INVOICE',
      status: 'READY_FOR_XML',
      issuancePointId,
      branchCode: '001',
      terminalCode: '00001',
      sequenceValue: 1n,
      consecutive: '00100001010000000001',
      clave:
        `506120926${input.companyId.replace(/-/g, '').slice(0, 12)}00100001010000000001123456789`.slice(
          0,
          50,
        ),
      securityCode: '12345678',
      issuerSnapshot: {
        legalName: 'Persistence Fixture SA',
        identificationType: 'JURIDICA',
        identificationNumber: '3101000000',
      },
      receiverSnapshot: { name: 'Receiver SA', identificationNumber: '3101000001' },
      currency: 'CRC',
      saleCondition: '01',
      paymentMethod: '01',
      lines: [
        {
          lineNumber: 1,
          cabysCode: '1234567890123',
          description: 'Persistence fixture line',
          unitMeasure: 'Sp',
          quantity: '1.00000',
          unitPrice: '1000.00000',
        },
      ],
      totals: {
        grossAmount: '1000.00000',
        discountAmount: '0.00000',
        taxAmount: '0.00000',
        totalAmount: '1000.00000',
      },
    },
  });
}

describe('Fiscal XML persistence metadata (E2E, PostgreSQL)', () => {
  const prisma = new PrismaClient();

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await resetFiscalE2eData(prisma);
  });

  afterAll(async () => {
    await resetFiscalE2eData(prisma);
    await prisma.$disconnect();
  });

  it('persists F2.3 lifecycle states, artifact metadata and certificate references without plaintext secrets', async () => {
    const tenant = await createTestTenant(prisma);
    const company = await createTestCompany(prisma, tenant.id);
    const document = await createReadyForXmlDocument(prisma, {
      tenantId: tenant.id,
      companyId: company.id,
    });

    const certificate = await prisma.fiscalSigningCertificate.create({
      data: {
        id: randomUUID(),
        tenantId: tenant.id,
        companyId: company.id,
        environment: 'SANDBOX',
        status: 'ACTIVE',
        certificateType: 'HACIENDA_CRYPTOGRAPHIC_KEY',
        certificateSecretReference: 'secret://fiscal/certificates/sandbox/current',
        passwordSecretReference: 'secret://fiscal/certificates/sandbox/password',
        fingerprintSha256: 'a'.repeat(64),
        serialNumber: 'SERIAL-001',
        subjectName: 'CN=Persistence Fixture',
        issuerName: 'CN=Test Issuer',
        activeFrom: new Date('2026-01-01T00:00:00.000Z'),
      },
    });

    const artifact = await prisma.fiscalXmlArtifact.create({
      data: {
        id: randomUUID(),
        tenantId: tenant.id,
        companyId: company.id,
        fiscalDocumentId: document.id,
        environment: 'SANDBOX',
        documentType: 'INVOICE',
        schemaVersion: '4.4',
        xmlProfileVersion: 'serializer-v1',
        unsignedXmlStorageKey: 'fiscal/tenant/company/sandbox/document/v4.4/unsigned.xml',
        unsignedXmlSha256: 'b'.repeat(64),
        signedXmlStorageKey: 'fiscal/tenant/company/sandbox/document/v4.4/signed.xml',
        signedXmlSha256: 'c'.repeat(64),
        xsdValidationStatus: 'VALID',
        xsdValidatedAt: new Date('2026-09-12T12:00:00.000Z'),
        xsdValidationErrors: [],
        signingCertificateId: certificate.id,
        signatureProfile: 'XAdES-EPES',
        signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
        digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
        canonicalizationMethod: 'http://www.w3.org/2001/10/xml-exc-c14n#',
        signedAt: new Date('2026-09-12T12:01:00.000Z'),
        signatureVerifiedAt: new Date('2026-09-12T12:02:00.000Z'),
      },
    });

    await prisma.fiscalDocument.update({
      where: { id: document.id },
      data: { status: 'XML_GENERATED' },
    });
    await prisma.fiscalDocument.update({
      where: { id: document.id },
      data: { status: 'XML_VALIDATED' },
    });
    await prisma.fiscalDocument.update({
      where: { id: document.id },
      data: { status: 'SIGNED' },
    });
    const readyToSubmit = await prisma.fiscalDocument.update({
      where: { id: document.id },
      data: { status: 'READY_TO_SUBMIT' },
    });

    const persistedArtifact = await prisma.fiscalXmlArtifact.findUniqueOrThrow({
      where: { id: artifact.id },
      include: { signingCertificate: true },
    });

    expect(readyToSubmit.status).toBe('READY_TO_SUBMIT');
    expect(persistedArtifact.unsignedXmlSha256).toBe('b'.repeat(64));
    expect(persistedArtifact.signedXmlSha256).toBe('c'.repeat(64));
    expect(persistedArtifact.signingCertificate?.tenantId).toBe(tenant.id);
    expect(persistedArtifact.signingCertificate?.companyId).toBe(company.id);
    expect(persistedArtifact.signingCertificate?.environment).toBe('SANDBOX');

    const serializedCertificate = JSON.stringify(persistedArtifact.signingCertificate);
    expect(serializedCertificate).not.toContain('privateKeyPem');
    expect(serializedCertificate).not.toContain('certificatePem');
    expect(serializedCertificate).not.toContain('test-passphrase');
  });

  it('enforces company/tenant ownership for certificate metadata through foreign keys and scoped reads', async () => {
    const tenant = await createTestTenant(prisma);
    const company = await createTestCompany(prisma, tenant.id);
    const otherCompany = await createTestCompany(prisma, tenant.id);

    const activeSandboxCertificate = await prisma.fiscalSigningCertificate.create({
      data: {
        id: randomUUID(),
        tenantId: tenant.id,
        companyId: company.id,
        environment: 'SANDBOX',
        status: 'ACTIVE',
        certificateType: 'HACIENDA_CRYPTOGRAPHIC_KEY',
        certificateSecretReference: 'secret://sandbox/certificate',
        passwordSecretReference: 'secret://sandbox/password',
      },
    });
    await prisma.fiscalSigningCertificate.create({
      data: {
        id: randomUUID(),
        tenantId: tenant.id,
        companyId: otherCompany.id,
        environment: 'SANDBOX',
        status: 'ACTIVE',
        certificateType: 'HACIENDA_CRYPTOGRAPHIC_KEY',
        certificateSecretReference: 'secret://other/certificate',
        passwordSecretReference: 'secret://other/password',
      },
    });

    const scopedCertificate = await prisma.fiscalSigningCertificate.findFirstOrThrow({
      where: {
        tenantId: tenant.id,
        companyId: company.id,
        environment: 'SANDBOX',
        status: 'ACTIVE',
      },
    });
    const crossCompanyCertificate = await prisma.fiscalSigningCertificate.findFirst({
      where: {
        tenantId: tenant.id,
        companyId: company.id,
        environment: 'PRODUCTION',
        status: 'ACTIVE',
      },
    });

    expect(scopedCertificate.id).toBe(activeSandboxCertificate.id);
    expect(crossCompanyCertificate).toBeNull();
    await expect(
      prisma.fiscalSigningCertificate.create({
        data: {
          id: randomUUID(),
          tenantId: randomUUID(),
          companyId: company.id,
          environment: 'SANDBOX',
          status: 'ACTIVE',
          certificateType: 'HACIENDA_CRYPTOGRAPHIC_KEY',
          certificateSecretReference: 'secret://invalid/certificate',
          passwordSecretReference: 'secret://invalid/password',
        },
      }),
    ).rejects.toThrow();
  });
});
