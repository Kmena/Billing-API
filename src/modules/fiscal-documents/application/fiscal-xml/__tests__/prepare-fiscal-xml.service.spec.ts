import { BadRequestException } from '@nestjs/common';
import { PrepareFiscalXmlService } from '../prepare-fiscal-xml.service';
import { HaciendaV44XmlSerializerAdapter } from '../../../infrastructure/xml/hacienda-v44-xml-serializer.adapter';
import { Xsd11ValidatorAdapter } from '../../../infrastructure/xml/xsd11-validator.adapter';
import { NodeXadesEpesSignerAdapter } from '../../../../../infrastructure/signing/adapters/node-xades-epes-signer.adapter';
import {
  createFiscalXmlSnapshot,
  createTestSigningMaterial,
} from '../../../domain/fiscal-xml/__tests__/fiscal-xml-test-fixtures';
import { FISCAL_XML_ERROR } from '../../../domain/fiscal-xml/fiscal-xml.errors';

const apiKeyId = '44444444-4444-4444-8444-444444444444';
const artifactId = '55555555-5555-4555-8555-555555555555';
const certificateId = '66666666-6666-4666-8666-666666666666';
const validationOrder: string[] = [];

function createDocument(type: 'INVOICE' | 'TICKET') {
  const snapshot = createFiscalXmlSnapshot(type);
  return {
    ...snapshot,
    issuancePointId: '77777777-7777-4777-8777-777777777777',
    branchCode: '001',
    terminalCode: '00001',
    sequenceValue: BigInt(1),
    securityCode: '12345678',
    idempotencyKey: null,
    requestHash: null,
    createdAt: new Date('2026-09-13T00:00:00.000Z'),
    updatedAt: new Date('2026-09-13T00:00:00.000Z'),
    xmlArtifacts: [],
  };
}

function createService(
  document: ReturnType<typeof createDocument>,
  overrides: Record<string, unknown> = {},
) {
  const uploads = new Map<string, Buffer>();
  const material = createTestSigningMaterial();
  let artifact = {
    id: artifactId,
    tenantId: document.tenantId,
    companyId: document.companyId,
    fiscalDocumentId: document.id,
    environment: document.environment,
    documentType: document.type,
    schemaVersion: 'v4.4',
    xmlProfileVersion: 'serializer-v1',
    unsignedXmlSha256: null as string | null,
    signedXmlSha256: null as string | null,
    unsignedXmlStorageKey: null as string | null,
    signedXmlStorageKey: null as string | null,
    signedAt: null as Date | null,
    signatureVerifiedAt: null as Date | null,
    signingCertificateId: null as string | null,
    xsdValidationStatus: 'NOT_VALIDATED' as string,
    xsdValidatedAt: null as Date | null,
    xsdValidationErrors: null as unknown,
    lastErrorCode: null as string | null,
    lastErrorMessage: null as string | null,
    processingAttemptCount: 1,
  };

  const prisma = {
    fiscalDocument: {
      findFirst: jest.fn().mockResolvedValue(document),
      update: jest.fn().mockImplementation(({ data }) => {
        Object.assign(document, data);
        return Promise.resolve({ ...document });
      }),
    },
    fiscalXmlArtifact: {
      create: jest.fn().mockResolvedValue(artifact),
      update: jest.fn().mockImplementation(({ data }) => {
        artifact = { ...artifact, ...data };
        return Promise.resolve(artifact);
      }),
    },
    apiKeyCompany: {
      findUnique: jest.fn().mockResolvedValue({ apiKeyId, companyId: document.companyId }),
    },
    $transaction: jest.fn().mockImplementation(async (input) => {
      if (Array.isArray(input)) return Promise.all(input);
      return input(prisma);
    }),
  };

  const auditService = { record: jest.fn() };
  const certificateService = {
    getActiveCertificate: jest.fn().mockResolvedValue({
      id: certificateId,
      tenantId: document.tenantId,
      companyId: document.companyId,
      environment: document.environment,
      certificateType: 'HACIENDA_CRYPTOGRAPHIC_KEY',
      secret: {
        pkcs12Base64: material.pkcs12Base64,
        passphrase: material.passphrase,
      },
    }),
  };
  const serializer = overrides.serializer ?? new HaciendaV44XmlSerializerAdapter();
  const signer = overrides.signer ?? new NodeXadesEpesSignerAdapter();
  const xsdValidator = overrides.xsdValidator ?? new Xsd11ValidatorAdapter();
  const validatingXsd = {
    validate: jest.fn((generated) => {
      validationOrder.push('xsd-validate');
      return (xsdValidator as Xsd11ValidatorAdapter).validate(generated);
    }),
  };
  const storage = {
    upload: jest.fn().mockImplementation((key: string, content: Buffer) => {
      uploads.set(key, Buffer.from(content));
      return Promise.resolve(key);
    }),
    download: jest.fn((key: string) => Promise.resolve(uploads.get(key) ?? Buffer.alloc(0))),
    getSignedUrl: jest.fn(),
    delete: jest.fn(),
  };

  const verifyingSigner = {
    sign: jest.fn(async (xml: string, certificate) => {
      validationOrder.push('sign');
      return (signer as NodeXadesEpesSignerAdapter).sign(xml, certificate);
    }),
    verify: jest.fn(async (signedXml: string) => {
      validationOrder.push('verify');
      return (signer as NodeXadesEpesSignerAdapter).verify(signedXml);
    }),
  };

  return {
    service: new PrepareFiscalXmlService(
      prisma as never,
      auditService as never,
      certificateService as never,
      serializer as never,
      validatingXsd as never,
      verifyingSigner as never,
      storage as never,
    ),
    prisma,
    storage,
    uploads,
    artifact: () => artifact,
    xsdValidator: validatingXsd,
    signer: verifyingSigner,
    auditService,
  };
}

describe('PrepareFiscalXmlService', () => {
  beforeEach(() => {
    validationOrder.length = 0;
  });

  it.each(['INVOICE', 'TICKET'] as const)(
    'processes %s with signed-XSD validation and persists the same signed bytes',
    async (type) => {
      const document = createDocument(type);
      const { service, storage, uploads, artifact } = createService(document);

      const result = await service.execute({
        tenantId: document.tenantId,
        documentId: document.id,
        apiKeyId,
        scopes: [type === 'INVOICE' ? 'invoices:write' : 'tickets:write'],
        actor: 'apiKey:test',
      });

      expect(validationOrder).toEqual(['sign', 'verify', 'xsd-validate']);
      expect(result.status).toBe('READY_TO_SUBMIT');
      expect(document.status).toBe('READY_TO_SUBMIT');
      expect(artifact().xsdValidationStatus).toBe('VALID');
      expect(artifact().signedXmlStorageKey).toContain('/signed.xml');
      const signedUpload = uploads.get(artifact().signedXmlStorageKey ?? '');
      expect(signedUpload?.toString('utf8')).toContain('<ds:Signature');
      expect(artifact().signedXmlSha256).toBeDefined();
      expect(storage.upload).toHaveBeenCalledWith(
        artifact().signedXmlStorageKey,
        signedUpload,
        expect.objectContaining({ artifactKind: 'signed' }),
      );
    },
  );

  it('returns READY_TO_SUBMIT metadata without mutating signed artifacts', async () => {
    const document = createDocument('INVOICE');
    document.status = 'READY_TO_SUBMIT';
    document.xmlArtifacts = [
      {
        id: artifactId,
        schemaVersion: 'v4.4',
        unsignedXmlSha256: 'u'.repeat(64),
        signedXmlSha256: 's'.repeat(64),
        signedAt: new Date('2026-09-13T00:00:00.000Z'),
        signatureVerifiedAt: new Date('2026-09-13T00:00:01.000Z'),
        signingCertificateId: certificateId,
      } as never,
    ];
    const { service, storage, signer, xsdValidator } = createService(document);

    const result = await service.execute({
      tenantId: document.tenantId,
      documentId: document.id,
      apiKeyId,
      scopes: ['invoices:write'],
    });

    expect(result.signedXmlSha256).toBe('s'.repeat(64));
    expect(storage.upload).not.toHaveBeenCalled();
    expect(signer.sign).not.toHaveBeenCalled();
    expect(xsdValidator.validate).not.toHaveBeenCalled();
  });

  it('does not persist signed bytes when signed XML fails official XSD validation', async () => {
    const document = createDocument('INVOICE');
    const xsdValidator = {
      validate: jest.fn(() => ({
        isValid: false,
        schemaVersion: 'v4.4',
        errors: [{ code: FISCAL_XML_ERROR.xmlValidationFailed, message: '<Clave>bad</Clave>' }],
      })),
    };
    const { service, storage, artifact, auditService } = createService(document, { xsdValidator });

    await expect(
      service.execute({
        tenantId: document.tenantId,
        documentId: document.id,
        apiKeyId,
        scopes: ['invoices:write'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(storage.upload).toHaveBeenCalledTimes(1);
    expect(artifact().signedXmlStorageKey).toBeNull();
    expect(artifact().lastErrorCode).toBe(FISCAL_XML_ERROR.xmlValidationFailed);
    expect(artifact().lastErrorMessage).toBe('<xml omitted>bad<xml omitted>');
    expect(document.status).not.toBe('READY_TO_SUBMIT');
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'fiscal-xml.validation-failed',
        metadata: expect.not.objectContaining({ xml: expect.any(String) }),
      }),
    );
  });

  it('does not record XML bodies or signing secrets in audit metadata', async () => {
    const document = createDocument('INVOICE');
    const { service, auditService } = createService(document);

    await service.execute({
      tenantId: document.tenantId,
      documentId: document.id,
      apiKeyId,
      scopes: ['invoices:write'],
      actor: 'apiKey:test',
    });

    for (const call of auditService.record.mock.calls) {
      const serialized = JSON.stringify(call[0].metadata);
      expect(serialized).not.toContain('<FacturaElectronica');
      expect(serialized).not.toContain('PRIVATE KEY');
      expect(serialized).not.toContain('test-passphrase');
    }
  });

  it('does not run official XSD validation when signature verification fails', async () => {
    const document = createDocument('INVOICE');
    const signer = {
      sign: jest.fn(async (xml: string) => `${xml}<ds:Signature/>`),
      verify: jest.fn(async () => ({ isValid: false, validationErrors: ['bad-signature'] })),
    };
    const { service, xsdValidator, artifact } = createService(document, { signer });

    await expect(
      service.execute({
        tenantId: document.tenantId,
        documentId: document.id,
        apiKeyId,
        scopes: ['invoices:write'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(xsdValidator.validate).not.toHaveBeenCalled();
    expect(artifact().lastErrorCode).toBe(FISCAL_XML_ERROR.signatureVerificationFailed);
    expect(document.status).not.toBe('READY_TO_SUBMIT');
  });
});
