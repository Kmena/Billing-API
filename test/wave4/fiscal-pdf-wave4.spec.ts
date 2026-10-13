import { createHash } from 'crypto';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { createCanvas } from '@napi-rs/canvas';
import { ConfigService } from '@nestjs/config';
import { LocalStorageAdapter } from '../../src/infrastructure/storage/adapters/local-storage.adapter';
import {
  DisposableTestStorage,
  provisionDisposableTestStorage,
} from '../../src/infrastructure/storage/test-storage-safety';
import { S3StorageAdapter } from '../../src/infrastructure/storage/adapters/s3-storage.adapter';
import {
  CompanyPdfSettingsAccessDeniedException,
  CompanyPdfSettingsNotFoundException,
  CompanyPdfSettingsService,
  MAX_LOGO_BYTES,
  MAX_LOGO_HEIGHT,
  MAX_LOGO_PIXELS,
  MAX_LOGO_WIDTH,
  UnsafeLogoException,
} from '../../src/modules/fiscal-documents/application/pdf/company-pdf-settings.service';
import {
  FiscalArtifactAccessDeniedException,
  FiscalArtifactService,
} from '../../src/modules/fiscal-documents/application/artifacts/fiscal-artifact.service';
import { FiscalPdfArtifactStateService } from '../../src/modules/fiscal-documents/application/artifacts/fiscal-pdf-artifact-state.service';
import {
  ArtifactNotFoundException,
  FiscalEvidenceResolverService,
} from '../../src/modules/fiscal-documents/application/artifacts/fiscal-evidence-resolver.service';
import { PdfjsValidPdfVerifierAdapter } from '../../src/modules/fiscal-documents/infrastructure/pdf/pdfjs-valid-pdf-verifier.adapter';
import { BillingDefaultV1PdfRendererAdapter } from '../../src/modules/fiscal-documents/infrastructure/pdf/billing-default-v1-pdf-renderer.adapter';
import { ReadOnlyFiscalXmlParser } from '../../src/modules/fiscal-documents/application/fiscal-representation/read-only-fiscal-xml-parser';
import { medicationFixture } from '../wave0/fixtures/fiscal-pdf-production-fixtures';
import {
  GenerateFiscalPdfService,
  PdfGenerationException,
} from '../../src/modules/fiscal-documents/application/artifacts/generate-fiscal-pdf.service';

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

const validImage = (mime: 'image/png' | 'image/jpeg', width = 2, height = 2): Buffer => {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.fillStyle = '#123456';
  context.fillRect(0, 0, width, height);
  return mime === 'image/png' ? canvas.toBuffer('image/png' as never) : canvas.toBuffer(mime);
};

const apiAuthorization = (scopes: readonly string[] = ['invoices:read', 'invoices:write']) => ({
  kind: 'API_KEY' as const,
  apiKeyId: 'api-key-1',
  scopes,
});

const brandingHarness = (options?: {
  company?: unknown;
  binding?: unknown;
  upsertError?: Error;
}) => {
  const prisma = {
    company: {
      findFirst: jest
        .fn()
        .mockResolvedValue(options?.company === undefined ? { id: 'company-1' } : options.company),
    },
    apiKeyCompany: {
      findUnique: jest
        .fn()
        .mockResolvedValue(options?.binding === undefined ? {} : options.binding),
    },
    companyPdfSettings: {
      findFirst: jest.fn().mockResolvedValue(null),
      upsert: options?.upsertError
        ? jest.fn().mockRejectedValue(options.upsertError)
        : jest.fn().mockResolvedValue({}),
    },
  };
  const storage = {
    upload: jest.fn().mockResolvedValue('key'),
    download: jest.fn(),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  return {
    prisma,
    storage,
    service: new CompanyPdfSettingsService(prisma as never, storage as never),
  };
};

describe('Fiscal PDF Wave 4 — branding authorization and logo safety', () => {
  it('authorizes read, update and upload through tenant/company, binding and scopes', async () => {
    const { prisma, storage, service } = brandingHarness();
    const authorization = apiAuthorization();
    await expect(
      service.getBrandingView('tenant-1', 'company-1', authorization),
    ).resolves.toMatchObject({
      templateId: 'BILLING_DEFAULT_V1',
    });
    await service.updateSettings({
      tenantId: 'tenant-1',
      companyId: 'company-1',
      authorization,
      primaryColor: '#123456',
    });
    await service.uploadLogo({
      tenantId: 'tenant-1',
      companyId: 'company-1',
      authorization,
      logoBytes: validImage('image/png'),
      declaredMimeType: 'image/png',
    });
    expect(prisma.company.findFirst).toHaveBeenCalledTimes(3);
    expect(prisma.apiKeyCompany.findUnique).toHaveBeenCalledTimes(3);
    expect(storage.upload).toHaveBeenCalledTimes(1);
  });

  it.each(['read', 'update', 'upload'] as const)(
    'denies cross-tenant known foreign UUID %s before settings/storage access',
    async (operation) => {
      const { prisma, storage, service } = brandingHarness({ company: null });
      const authorization = apiAuthorization();
      const action =
        operation === 'read'
          ? service.getBrandingView('attacker', 'known-foreign-company', authorization)
          : operation === 'update'
            ? service.updateSettings({
                tenantId: 'attacker',
                companyId: 'known-foreign-company',
                authorization,
                footerText: 'x',
              })
            : service.uploadLogo({
                tenantId: 'attacker',
                companyId: 'known-foreign-company',
                authorization,
                logoBytes: validImage('image/png'),
                declaredMimeType: 'image/png',
              });
      await expect(action).rejects.toBeInstanceOf(CompanyPdfSettingsNotFoundException);
      expect(prisma.apiKeyCompany.findUnique).not.toHaveBeenCalled();
      expect(prisma.companyPdfSettings.findFirst).not.toHaveBeenCalled();
      expect(prisma.companyPdfSettings.upsert).not.toHaveBeenCalled();
      expect(storage.upload).not.toHaveBeenCalled();
      expect(storage.download).not.toHaveBeenCalled();
    },
  );

  it('denies unbound keys and insufficient read/write scopes', async () => {
    const unbound = brandingHarness({ binding: null });
    await expect(
      unbound.service.getBrandingView('tenant-1', 'company-1', apiAuthorization()),
    ).rejects.toBeInstanceOf(CompanyPdfSettingsAccessDeniedException);
    const scoped = brandingHarness();
    await expect(
      scoped.service.getBrandingView('tenant-1', 'company-1', apiAuthorization([])),
    ).rejects.toBeInstanceOf(CompanyPdfSettingsAccessDeniedException);
    await expect(
      scoped.service.updateSettings({
        tenantId: 'tenant-1',
        companyId: 'company-1',
        authorization: apiAuthorization(['invoices:read']),
        footerText: 'x',
      }),
    ).rejects.toBeInstanceOf(CompanyPdfSettingsAccessDeniedException);
    expect(scoped.prisma.companyPdfSettings.upsert).not.toHaveBeenCalled();
  });

  it('accepts decoded PNG/JPEG buffers and freezes all logo limits', async () => {
    expect([MAX_LOGO_BYTES, MAX_LOGO_WIDTH, MAX_LOGO_HEIGHT, MAX_LOGO_PIXELS]).toEqual([
      2_097_152, 2048, 2048, 4_194_304,
    ]);
    const { service, storage } = brandingHarness();
    for (const mime of ['image/png', 'image/jpeg'] as const) {
      await service.uploadLogo({
        tenantId: 'tenant-1',
        companyId: 'company-1',
        authorization: apiAuthorization(),
        logoBytes: validImage(mime),
        declaredMimeType: mime,
      });
    }
    expect(storage.upload).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['SVG', Buffer.from('<svg/>'), 'image/svg+xml'],
    ['MIME mismatch', validImage('image/png'), 'image/jpeg'],
    ['truncated PNG', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png'],
    ['malformed JPEG', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]), 'image/jpeg'],
    ['oversized', Buffer.alloc(MAX_LOGO_BYTES + 1, 0xff), 'image/jpeg'],
  ])('rejects %s before storage mutation', async (_label, bytes, declaredMimeType) => {
    const { service, storage } = brandingHarness();
    await expect(
      service.uploadLogo({
        tenantId: 'tenant-1',
        companyId: 'company-1',
        authorization: apiAuthorization(),
        logoBytes: bytes,
        declaredMimeType,
      }),
    ).rejects.toBeInstanceOf(UnsafeLogoException);
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('rejects dimensions over 2048 before decode/storage', async () => {
    const bytes = Buffer.from(validImage('image/png'));
    bytes.writeUInt32BE(2049, 16);
    const { service, storage } = brandingHarness();
    await expect(
      service.uploadLogo({
        tenantId: 'tenant-1',
        companyId: 'company-1',
        authorization: apiAuthorization(),
        logoBytes: bytes,
        declaredMimeType: 'image/png',
      }),
    ).rejects.toBeInstanceOf(UnsafeLogoException);
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('accepts the exact 2048 × 2048 / 4,194,304-pixel boundary', async () => {
    const { service, storage } = brandingHarness();
    const logoBytes = validImage('image/png', MAX_LOGO_WIDTH, MAX_LOGO_HEIGHT);
    expect(logoBytes.length).toBeLessThanOrEqual(MAX_LOGO_BYTES);
    await expect(
      service.uploadLogo({
        tenantId: 'tenant-1',
        companyId: 'company-1',
        authorization: apiAuthorization(),
        logoBytes,
        declaredMimeType: 'image/png',
      }),
    ).resolves.toBeUndefined();
    expect(storage.upload).toHaveBeenCalledTimes(1);
  });

  it.each(['https://attacker.test/logo.png', 'C:\\secret\\logo.png'])(
    'rejects URL/filesystem input %s with zero storage I/O',
    async (logoBytes) => {
      const { service, storage } = brandingHarness();
      await expect(
        service.uploadLogo({
          tenantId: 'tenant-1',
          companyId: 'company-1',
          authorization: apiAuthorization(),
          logoBytes: logoBytes as never,
          declaredMimeType: 'image/png',
        }),
      ).rejects.toBeInstanceOf(UnsafeLogoException);
      expect(storage.upload).not.toHaveBeenCalled();
      expect(storage.download).not.toHaveBeenCalled();
    },
  );

  it('deletes newly uploaded logo bytes when metadata persistence fails', async () => {
    const { service, storage } = brandingHarness({ upsertError: new Error('db unavailable') });
    await expect(
      service.uploadLogo({
        tenantId: 'tenant-1',
        companyId: 'company-1',
        authorization: apiAuthorization(),
        logoBytes: validImage('image/png'),
        declaredMimeType: 'image/png',
      }),
    ).rejects.toThrow('db unavailable');
    expect(storage.delete).toHaveBeenCalledTimes(1);
  });
});

describe('Fiscal PDF Wave 4 — typed storage contract and compensation', () => {
  let storageLease: DisposableTestStorage;

  beforeEach(() => {
    storageLease = provisionDisposableTestStorage();
  });

  afterEach(() => {
    storageLease.dispose();
  });
  it('maps PDF/XML MIME to real S3 ContentType and preserves custom metadata', async () => {
    const config = {
      get: jest.fn((key: string) =>
        key === 'storage.s3Bucket'
          ? 'billing-p0-' + storageLease.runId + '-wave4'
          : key === 'storage.s3Endpoint'
            ? 'http://127.0.0.1:4566'
            : key === 'storage.awsRegion'
              ? 'us-east-1'
              : undefined,
      ),
    } as unknown as ConfigService;
    const adapter = new S3StorageAdapter(config);
    const send = jest.fn().mockResolvedValue({});
    Object.defineProperty(adapter, 'client', { value: { send } });
    await adapter.upload({
      key: 'fiscal/test.pdf',
      bytes: Buffer.from('%PDF'),
      contentType: 'application/pdf',
      metadata: { sha256: 'pdf-hash', purpose: 'fiscal' },
    });
    await adapter.upload({
      key: 'fiscal/test.xml',
      bytes: Buffer.from('<xml/>'),
      contentType: 'application/xml',
      metadata: { sha256: 'xml-hash' },
    });
    const commands = send.mock.calls.map(([command]) => command as PutObjectCommand);
    expect(commands[0].input).toMatchObject({
      ContentType: 'application/pdf',
      Metadata: { sha256: 'pdf-hash', purpose: 'fiscal' },
    });
    expect(commands[1].input).toMatchObject({
      ContentType: 'application/xml',
      Metadata: { sha256: 'xml-hash' },
    });
    expect(commands[0].input.Metadata).not.toHaveProperty('contentType');
  });

  it('keeps LocalStorage byte-identical with the typed request', async () => {
    const adapter = new LocalStorageAdapter(storageLease.rootPath, 'wave4-secret');
    const expected = Buffer.from([0, 1, 2, 3, 255]);
    await adapter.upload({
      key: 'tenant/artifact.bin',
      bytes: expected,
      contentType: 'application/octet-stream',
    });
    const actual = await adapter.download('tenant/artifact.bin');
    expect(actual.equals(expected)).toBe(true);
    expect(sha256(actual)).toBe(sha256(expected));
  });

  it('compensates an uploaded PDF when metadata persistence has no matching winner', async () => {
    const bytes = Buffer.from('%PDF-wave4-generated');
    const rendered = {
      bytes,
      sha256: sha256(bytes),
      sizeBytes: bytes.length,
      templateId: 'BILLING_DEFAULT_V1',
      rendererVersion: '2.0.0',
    };
    const prisma = {
      fiscalArtifact: {
        findFirst: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null),
        create: jest.fn().mockRejectedValue(new Error('db write failed')),
      },
      fiscalDocument: {
        findFirst: jest.fn().mockResolvedValue({
          type: 'INVOICE',
          clave: '50612092600310100000000100001010000000001123456789',
          consecutive: '00100001010000000001',
          issueDate: new Date('2026-01-01T00:00:00Z'),
          issuerSnapshot: {},
          receiverSnapshot: null,
          lines: [],
          totals: {},
          currency: 'CRC',
          exchangeRate: null,
          saleCondition: '01',
          creditTermDays: null,
          paymentMethod: '01',
          environment: 'SANDBOX',
        }),
      },
    };
    const storage = {
      upload: jest.fn().mockResolvedValue('key'),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    const service = new GenerateFiscalPdfService(
      prisma as never,
      storage as never,
      { render: jest.fn().mockResolvedValue(rendered) } as never,
      { buildQrContent: jest.fn().mockReturnValue('qr') } as never,
      {
        getBrandingView: jest.fn().mockResolvedValue({ templateId: 'BILLING_DEFAULT_V1' }),
      } as never,
      true,
      undefined,
      {
        resolveSignedXmlBytes: jest.fn().mockResolvedValue({
          bytes: Buffer.from(medicationFixture.xml),
          sha256: sha256(Buffer.from(medicationFixture.xml)),
        }),
      } as never,
      { generateVerified: jest.fn().mockResolvedValue({ rendered }) } as never,
    );
    await expect(
      service.generateOrReuse('tenant-1', 'company-1', 'document-1'),
    ).rejects.toBeInstanceOf(PdfGenerationException);
    expect(storage.upload).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: 'application/pdf', bytes }),
    );
    expect(storage.delete).toHaveBeenCalledWith(
      expect.stringContaining(rendered.sha256.substring(0, 12)),
    );
  });
});

describe('Fiscal PDF Wave 4 — artifact download authorization and integrity', () => {
  let clave = '';
  let consecutive = '';
  const access = {
    tenantId: 'tenant-1',
    companyId: 'company-1',
    apiKeyId: 'api-key-1',
    scopes: ['invoices:read'],
  };
  const request = {
    fiscalDocumentId: 'document-1',
    environment: 'SANDBOX' as const,
    documentType: 'INVOICE' as const,
    artifactId: 'artifact-1',
  };
  let realPdf: Buffer;

  beforeAll(async () => {
    const xmlBytes = Buffer.from(medicationFixture.xml, 'utf8');
    const view = new ReadOnlyFiscalXmlParser().project({
      bytes: xmlBytes,
      expectedSha256: sha256(xmlBytes),
      documentType: 'INVOICE',
    });
    clave = view.document.clave;
    consecutive = view.document.consecutive;
    realPdf = (await new BillingDefaultV1PdfRendererAdapter().renderRepresentation(view)).bytes;
  });

  const harness = (options?: {
    company?: unknown;
    binding?: unknown;
    document?: unknown;
    artifact?: Record<string, unknown> | null;
    bytes?: Buffer;
  }) => {
    const bytes = options?.bytes ?? realPdf;
    const artifact =
      options?.artifact === null
        ? null
        : {
            id: 'artifact-1',
            tenantId: 'tenant-1',
            companyId: 'company-1',
            fiscalDocumentId: 'document-1',
            type: 'PDF',
            storageKey: 'fiscal-pdfs/artifact.pdf',
            sha256: sha256(bytes),
            contentType: 'application/pdf',
            sizeBytes: bytes.length,
            templateId: 'BILLING_DEFAULT_V1',
            rendererVersion: '2.0.0',
            supersededAt: null,
            createdAt: new Date('2026-10-06T00:00:00Z'),
            ...(options?.artifact ?? {}),
          };
    const prisma = {
      company: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            options?.company === undefined ? { id: 'company-1' } : options.company,
          ),
      },
      apiKeyCompany: {
        findUnique: jest
          .fn()
          .mockResolvedValue(options?.binding === undefined ? {} : options.binding),
      },
      fiscalDocument: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            options?.document === undefined
              ? { clave, consecutive, type: 'INVOICE' }
              : options.document,
          ),
      },
      fiscalArtifact: {
        findFirst: jest.fn().mockResolvedValue(artifact),
        findMany: jest.fn().mockResolvedValue(artifact ? [artifact] : []),
      },
    };
    const storage = { download: jest.fn().mockResolvedValue(bytes) };
    const evidence = new FiscalEvidenceResolverService(prisma as never, storage as never);
    const artifactState = new FiscalPdfArtifactStateService(storage as never, {
      verify: jest.fn().mockImplementation(async (candidate: Buffer) => {
        if (candidate.equals(realPdf)) {
          return {
            pageCount: 1,
            sizeBytes: candidate.length,
            normalizedText: '',
            parser: 'pdfjs-dist',
          };
        }
        throw new Error('Fixture PDF failed structural validation.');
      }),
    });
    return {
      prisma,
      storage,
      service: new FiscalArtifactService(
        prisma as never,
        storage as never,
        evidence,
        new PdfjsValidPdfVerifierAdapter(),
        artifactState,
      ),
    };
  };

  it('serves byte-identical parseable PDF with safe response metadata after full auth', async () => {
    const { service, storage } = harness();
    const result = await service.downloadArtifact(access, request);
    expect(result.bytes.equals(realPdf)).toBe(true);
    expect(result).toMatchObject({
      sizeBytes: realPdf.length,
      contentType: 'application/pdf',
      externalFilename: `${clave}.pdf`,
    });
    expect(service.buildContentDisposition(result.externalFilename)).toBe(
      `attachment; filename="${clave}.pdf"`,
    );
    expect(storage.download).toHaveBeenCalledTimes(1);
  });

  it('denies wrong tenant/company and known foreign UUID before fetching bytes', async () => {
    const { service, storage, prisma } = harness({ company: null });
    await expect(
      service.downloadArtifact({ ...access, tenantId: 'attacker' }, request),
    ).rejects.toBeInstanceOf(ArtifactNotFoundException);
    expect(prisma.apiKeyCompany.findUnique).not.toHaveBeenCalled();
    expect(prisma.fiscalDocument.findFirst).not.toHaveBeenCalled();
    expect(storage.download).not.toHaveBeenCalled();
  });

  it('denies unbound key and missing scope before fetching bytes', async () => {
    const unbound = harness({ binding: null });
    await expect(unbound.service.downloadArtifact(access, request)).rejects.toBeInstanceOf(
      FiscalArtifactAccessDeniedException,
    );
    expect(unbound.storage.download).not.toHaveBeenCalled();
    const scoped = harness();
    await expect(
      scoped.service.downloadArtifact({ ...access, scopes: [] }, request),
    ).rejects.toBeInstanceOf(FiscalArtifactAccessDeniedException);
    expect(scoped.storage.download).not.toHaveBeenCalled();
  });

  it.each([
    ['wrong document', { fiscalDocumentId: 'foreign-document' }],
    ['wrong environment', { environment: 'PRODUCTION' as const }],
    ['wrong type', { documentType: 'TICKET' as const }],
  ])('denies %s binding before artifact/storage lookup', async (_label, override) => {
    const { service, storage, prisma } = harness({ document: null });
    const scopedAccess =
      'documentType' in override && override.documentType === 'TICKET'
        ? { ...access, scopes: ['tickets:read'] }
        : access;
    await expect(
      service.downloadArtifact(scopedAccess, { ...request, ...override }),
    ).rejects.toBeInstanceOf(ArtifactNotFoundException);
    expect(prisma.fiscalArtifact.findFirst).not.toHaveBeenCalled();
    expect(storage.download).not.toHaveBeenCalled();
  });

  it('denies wrong artifact type/MIME/version metadata before fetching bytes', async () => {
    const { service, storage } = harness({
      artifact: { type: 'PDF', contentType: 'text/plain', rendererVersion: null },
    });
    await expect(service.downloadArtifact(access, request)).rejects.toBeInstanceOf(
      ArtifactNotFoundException,
    );
    expect(storage.download).not.toHaveBeenCalled();
  });

  it.each([
    [
      'historical mock',
      Buffer.from('%PDF-1.4-MOCK-BILLING-DEFAULT-V1\nnot structural'),
      'LEGACY_PDF_UNAVAILABLE',
    ],
    ['corrupt PDF', Buffer.from('%PDF-1.4\ntruncated'), 'PDF_INVALID_STRUCTURE'],
  ])('blocks %s bytes even when persisted hash matches', async (_label, bytes, code) => {
    const { service } = harness({
      bytes,
      artifact: _label === 'historical mock' ? { rendererVersion: '1.0.0' } : undefined,
    });
    await expect(service.downloadArtifact(access, request)).rejects.toMatchObject({ code });
  });

  it('blocks hash mismatch and byte-size mismatch', async () => {
    const hashMismatch = harness({ artifact: { sha256: '0'.repeat(64) } });
    await expect(hashMismatch.service.downloadArtifact(access, request)).rejects.toMatchObject({
      code: 'ARTIFACT_HASH_MISMATCH',
    });
    const sizeMismatch = harness({ artifact: { sizeBytes: realPdf.length + 1 } });
    await expect(sizeMismatch.service.downloadArtifact(access, request)).rejects.toMatchObject({
      code: 'ARTIFACT_HASH_MISMATCH',
    });
  });
});
