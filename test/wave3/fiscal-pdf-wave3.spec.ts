import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Test } from '@nestjs/testing';
import { validationSchema } from '../../src/infrastructure/config/config.validation-schema';
import {
  FISCAL_REPRESENTATION_PDF_RENDERER,
  PDF_RENDERER,
} from '../../src/modules/fiscal-documents/application/pdf/pdf-renderer.port';
import {
  FISCAL_REPRESENTATION_PDF_RENDERER_PROVIDER,
  NORMAL_PDF_RENDERER_PROVIDER,
  FiscalPdfConfigurationError,
  assertFiscalPdfBootstrapState,
  selectNormalFiscalPdfRenderer,
} from '../../src/modules/fiscal-documents/application/pdf/fiscal-pdf-provider-policy';
import {
  CURRENT_FISCAL_PDF_RENDERER_VERSION,
  CURRENT_FISCAL_PDF_TEMPLATE_ID,
  HISTORICAL_MOCK_PDF_RENDERER_VERSION,
  classifyFiscalPdfVersion,
} from '../../src/modules/fiscal-documents/application/pdf/fiscal-pdf-version-policy';
import {
  PdfRenderTimeoutError,
  runBoundedPdfRenderAttempt,
} from '../../src/modules/fiscal-documents/application/pdf/bounded-pdf-render-attempt';
import { PdfValidationError } from '../../src/modules/fiscal-documents/application/pdf/valid-pdf-verifier.port';
import { FiscalRepresentationPdfPipeline } from '../../src/modules/fiscal-documents/application/pdf/fiscal-representation-pdf-pipeline';
import {
  BILLING_DEFAULT_V1_FISCAL_REPRESENTATION_RENDERER_VERSION,
  BillingDefaultV1PdfRendererAdapter,
} from '../../src/modules/fiscal-documents/infrastructure/pdf/billing-default-v1-pdf-renderer.adapter';
import { MockPdfRendererAdapter } from '../../src/modules/fiscal-documents/infrastructure/pdf/mock-pdf-renderer.adapter';
import { PdfjsValidPdfVerifierAdapter } from '../../src/modules/fiscal-documents/infrastructure/pdf/pdfjs-valid-pdf-verifier.adapter';
import { ReadOnlyFiscalXmlParser } from '../../src/modules/fiscal-documents/application/fiscal-representation/read-only-fiscal-xml-parser';
import { medicationFixture } from '../wave0/fixtures/fiscal-pdf-production-fixtures';
import {
  GenerateFiscalPdfService,
  PdfGenerationException,
} from '../../src/modules/fiscal-documents/application/artifacts/generate-fiscal-pdf.service';

const hash = (value: Buffer): string => createHash('sha256').update(value).digest('hex');
const parser = new ReadOnlyFiscalXmlParser();
const realRenderer = new BillingDefaultV1PdfRendererAdapter();
const verifier = new PdfjsValidPdfVerifierAdapter();
const xmlBytes = Buffer.from(medicationFixture.xml, 'utf8');
const view = parser.project({
  bytes: xmlBytes,
  expectedSha256: hash(xmlBytes),
  documentType: 'INVOICE',
});
const expectedIdentity = {
  documentType: view.document.type,
  clave: view.document.clave,
  consecutive: view.document.consecutive,
};

describe('Fiscal PDF Wave 3 — provider and bootstrap containment', () => {
  it('resolves the real renderer in a normal isolated module', async () => {
    const module = await Test.createTestingModule({
      providers: [
        BillingDefaultV1PdfRendererAdapter,
        FISCAL_REPRESENTATION_PDF_RENDERER_PROVIDER,
        NORMAL_PDF_RENDERER_PROVIDER,
      ],
    }).compile();

    expect(module.get(PDF_RENDERER)).toBeInstanceOf(BillingDefaultV1PdfRendererAdapter);
    expect(module.get(FISCAL_REPRESENTATION_PDF_RENDERER)).toBeInstanceOf(
      BillingDefaultV1PdfRendererAdapter,
    );
    await module.close();
  });

  it('allows the mock only through an explicit testing-module override', async () => {
    const mock = new MockPdfRendererAdapter();
    const module = await Test.createTestingModule({
      providers: [
        BillingDefaultV1PdfRendererAdapter,
        FISCAL_REPRESENTATION_PDF_RENDERER_PROVIDER,
        NORMAL_PDF_RENDERER_PROVIDER,
      ],
    })
      .overrideProvider(PDF_RENDERER)
      .useValue(mock)
      .compile();

    expect(module.get(PDF_RENDERER)).toBe(mock);
    expect(module.get(FISCAL_REPRESENTATION_PDF_RENDERER)).toBeInstanceOf(
      BillingDefaultV1PdfRendererAdapter,
    );
    await module.close();
  });

  it.each(['development', 'staging', 'production', 'test'] as const)(
    'selects the real renderer for NODE_ENV=%s',
    (nodeEnv) => {
      const validation = validationSchema.validate({
        NODE_ENV: nodeEnv,
        DATABASE_URL: 'postgresql://test:test@localhost:5432/billing_test',
        JWT_SECRET: 'wave3-production-test-secret-at-least-32-chars',
        CORS_ALLOWED_ORIGINS: 'https://billing.example.test',
        HACIENDA_QR_URL_BASE: 'https://qr.example.test',
        HACIENDA_IDP_PRODUCTION_URL: 'https://idp.example.test/prod',
        HACIENDA_IDP_SANDBOX_URL: 'https://idp.example.test/sandbox',
        HACIENDA_IDP_CLIENT_ID_PRODUCTION: 'api-prod',
        HACIENDA_IDP_CLIENT_ID_SANDBOX: 'api-stag',
      });
      expect(validation.error).toBeUndefined();
      expect(selectNormalFiscalPdfRenderer(realRenderer)).toBe(realRenderer);
    },
  );

  it('defaults a missing NODE_ENV to safe development while retaining the real renderer', () => {
    const validation = validationSchema.validate({
      DATABASE_URL: 'postgresql://test:test@localhost:5432/billing_test',
    });
    expect(validation.error).toBeUndefined();
    expect(validation.value.NODE_ENV).toBe('development');
    expect(selectNormalFiscalPdfRenderer(realRenderer)).toBe(realRenderer);
  });

  it('rejects an invalid NODE_ENV without a mock fallback', () => {
    const validation = validationSchema.validate({
      NODE_ENV: 'ambiguous',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/billing_test',
    });
    expect(validation.error).toBeDefined();
  });

  it.each([
    { renderer: 'REAL', email: 'CAPTURED', verifierActive: true },
    { renderer: 'REAL', email: 'SMTP', verifierActive: true },
    {
      renderer: 'MOCK_TEST_ONLY',
      email: 'CAPTURED',
      verifierActive: true,
      isolatedTestOverride: true,
    },
  ] as const)('accepts the valid bootstrap state %#', (state) => {
    expect(() => assertFiscalPdfBootstrapState(state)).not.toThrow();
  });

  it.each([
    { renderer: 'MOCK_TEST_ONLY', email: 'SMTP', verifierActive: true },
    {
      renderer: 'MOCK_TEST_ONLY',
      email: 'SMTP',
      verifierActive: true,
      isolatedTestOverride: true,
    },
    { renderer: 'REAL', email: 'SMTP', verifierActive: false },
    { renderer: 'MOCK_TEST_ONLY', email: 'CAPTURED', verifierActive: true },
  ] as const)('rejects the invalid bootstrap state %#', (state) => {
    expect(() => assertFiscalPdfBootstrapState(state)).toThrow(FiscalPdfConfigurationError);
  });

  it('pauses the legacy generation path before any database or storage access', async () => {
    const findArtifact = jest.fn();
    const service = new GenerateFiscalPdfService(
      { fiscalArtifact: { findFirst: findArtifact } } as never,
      { upload: jest.fn() } as never,
      realRenderer,
      { buildQrContent: jest.fn() } as never,
      { getBrandingView: jest.fn() } as never,
      false,
    );

    await expect(service.generateOrReuse('tenant', 'company', 'document')).rejects.toBeInstanceOf(
      PdfGenerationException,
    );
    expect(findArtifact).not.toHaveBeenCalled();
  });
});

describe('Fiscal PDF Wave 3 — runtime PDF verifier and version policy', () => {
  let realPdf: Buffer;

  beforeAll(async () => {
    realPdf = (await realRenderer.renderRepresentation(view)).bytes;
  });

  it('completely parses a real 2.0.0 PDF and verifies all trusted identity fields', async () => {
    const result = await verifier.verify(realPdf, expectedIdentity, {
      maxSizeBytes: 10 * 1024 * 1024,
    });
    expect(result.parser).toBe('pdfjs-dist');
    expect(result.pageCount).toBeGreaterThanOrEqual(1);
    expect(result.sizeBytes).toBe(realPdf.length);
    expect(result.normalizedText).toContain('Factura Electrónica');
    expect(result.normalizedText).toContain(expectedIdentity.clave);
    expect(result.normalizedText).toContain(expectedIdentity.consecutive);
  });

  it('composes bounded rendering and verification before exposing generated bytes', async () => {
    const pipeline = new FiscalRepresentationPdfPipeline(realRenderer, verifier);
    const result = await pipeline.generateVerified(view, {
      timeoutMs: 5_000,
      limits: { maxSizeBytes: 10 * 1024 * 1024 },
    });
    expect(result.rendered.rendererVersion).toBe(CURRENT_FISCAL_PDF_RENDERER_VERSION);
    expect(result.verified.pageCount).toBeGreaterThanOrEqual(1);
    expect(result.verified.sizeBytes).toBe(result.rendered.bytes.length);
  });

  it('rejects historical mock bytes before structural parsing', async () => {
    const historicalMock = Buffer.from(
      '%PDF-1.4-MOCK-BILLING-DEFAULT-V1\nnot a structural PDF',
      'utf8',
    );
    await expect(verifier.verify(historicalMock, expectedIdentity)).rejects.toMatchObject({
      code: 'PDF_MOCK_DETECTED',
    });
  });

  it('rejects empty, corrupt and truncated PDF bytes as PDF_INVALID', async () => {
    for (const bytes of [
      Buffer.alloc(0),
      Buffer.from('not-pdf'),
      Buffer.from('%PDF-1.4\ntruncated', 'utf8'),
    ]) {
      await expect(verifier.verify(bytes, expectedIdentity)).rejects.toMatchObject({
        code: 'PDF_INVALID',
      });
    }
  });

  it('rejects oversized bytes before invoking the structural parser', async () => {
    const oversized = Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(16)]);
    await expect(
      verifier.verify(oversized, expectedIdentity, { maxSizeBytes: 10 }),
    ).rejects.toMatchObject({ code: 'PDF_OVERSIZED' });
  });

  it.each([
    { ...expectedIdentity, documentType: 'TICKET' as const },
    { ...expectedIdentity, clave: '9'.repeat(50) },
    { ...expectedIdentity, consecutive: '99999999999999999999' },
  ])('rejects mismatched trusted identity %#', async (identity) => {
    await expect(verifier.verify(realPdf, identity)).rejects.toBeInstanceOf(PdfValidationError);
  });

  it('classifies real current and historical mock identities without promotion', () => {
    expect(
      classifyFiscalPdfVersion({
        templateId: CURRENT_FISCAL_PDF_TEMPLATE_ID,
        rendererVersion: CURRENT_FISCAL_PDF_RENDERER_VERSION,
        structurallyValid: true,
        containsMockMarker: false,
      }),
    ).toBe('VALID_REAL_CURRENT');
    expect(
      classifyFiscalPdfVersion({
        templateId: CURRENT_FISCAL_PDF_TEMPLATE_ID,
        rendererVersion: HISTORICAL_MOCK_PDF_RENDERER_VERSION,
        structurallyValid: false,
        containsMockMarker: true,
      }),
    ).toBe('HISTORICAL_MOCK');
    expect(
      classifyFiscalPdfVersion({
        templateId: CURRENT_FISCAL_PDF_TEMPLATE_ID,
        rendererVersion: HISTORICAL_MOCK_PDF_RENDERER_VERSION,
        structurallyValid: true,
        containsMockMarker: false,
      }),
    ).toBe('VALID_REAL_OLDER_VERSION');
    expect(BILLING_DEFAULT_V1_FISCAL_REPRESENTATION_RENDERER_VERSION).toBe(
      CURRENT_FISCAL_PDF_RENDERER_VERSION,
    );
  });

  it('keeps pdfjs-dist runtime-only and pdf-lib test-only', () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(packageJson.dependencies['pdfjs-dist']).toBeDefined();
    expect(packageJson.devDependencies['pdfjs-dist']).toBeUndefined();
    expect(packageJson.devDependencies['pdf-lib']).toBeDefined();
    expect(packageJson.dependencies['pdf-lib']).toBeUndefined();
  });
});

describe('Fiscal PDF Wave 3 — bounded render attempts', () => {
  it('closes a timed-out attempt, signals cancellation and ignores late bytes', async () => {
    let abortCount = 0;
    let successCount = 0;
    const attempt = runBoundedPdfRenderAttempt(
      ({ signal }) =>
        new Promise<Buffer>((resolve) => {
          signal.addEventListener(
            'abort',
            () => {
              abortCount += 1;
              setTimeout(() => resolve(Buffer.from('late bytes')), 1);
            },
            { once: true },
          );
        }),
      5,
    );
    void attempt.then(
      () => {
        successCount += 1;
      },
      () => undefined,
    );

    await expect(attempt).rejects.toBeInstanceOf(PdfRenderTimeoutError);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(abortCount).toBe(1);
    expect(successCount).toBe(0);
  });

  it('keeps repeated cooperative timeouts bounded to one abort per attempt', async () => {
    let abortCount = 0;
    const attempts = Array.from({ length: 20 }, () =>
      runBoundedPdfRenderAttempt(
        ({ signal }) =>
          new Promise<never>((_resolve, reject) => {
            signal.addEventListener(
              'abort',
              () => {
                abortCount += 1;
                reject(signal.reason);
              },
              { once: true },
            );
          }),
        1,
      ),
    );

    const results = await Promise.allSettled(attempts);
    expect(results.every((result) => result.status === 'rejected')).toBe(true);
    expect(abortCount).toBe(attempts.length);
  });
});
