import { BadRequestException } from '@nestjs/common';
import { FiscalDocumentService, CreateFiscalDocumentCommand } from '../fiscal-document.service';

function service(): FiscalDocumentService {
  return new FiscalDocumentService({} as never, { record: jest.fn() } as never);
}

function line(overrides: Record<string, unknown> = {}) {
  return {
    lineNumber: 1,
    cabysCode: '8313100000100',
    description: 'Servicio fiscal de prueba',
    unitMeasure: 'Sp',
    quantity: '1.00000',
    unitPrice: '1000.00000',
    taxAmount: '130.00000',
    taxCode: '01',
    taxRateCode: '08',
    taxRate: '13.00000',
    ...overrides,
  };
}

function command(
  overrides: Partial<CreateFiscalDocumentCommand> = {},
): CreateFiscalDocumentCommand {
  return {
    tenantId: '22222222-2222-4222-8222-222222222222',
    companyId: '33333333-3333-4333-8333-333333333333',
    environment: 'SANDBOX',
    type: 'INVOICE',
    receiver: {
      name: 'Receiver Test Sociedad Anonima',
      identificationType: 'JURIDICA',
      identificationNumber: '3101000001',
      email: 'receiver@example.com',
    },
    currency: 'CRC',
    exchangeRate: '1.00000',
    saleCondition: '01',
    paymentMethod: '01',
    lines: [line()],
    idempotencyKey: 'idem-1',
    apiKeyId: '44444444-4444-4444-8444-444444444444',
    actor: 'test',
    ...overrides,
  };
}

function validate(input: CreateFiscalDocumentCommand): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (service() as any).validateCreateCommand(input);
}

function expectCode(input: CreateFiscalDocumentCommand, code: string): void {
  try {
    validate(input);
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toMatchObject({ code });
  }
}

describe('Inventori P0 fiscal validation', () => {
  it('accepts zero discount without discount metadata', () => {
    expect(() => validate(command())).not.toThrow();
  });

  it('accepts one discounted line with explicit Hacienda discount metadata', () => {
    expect(() =>
      validate(
        command({
          lines: [
            line({
              discountAmount: '100.00000',
              discountCode: '07',
              discountNature: 'Descuento comercial Inventori',
              taxAmount: '117.00000',
            }),
          ],
        }),
      ),
    ).not.toThrow();
  });

  it('accepts multiple and mixed discounted/non-discounted lines', () => {
    expect(() =>
      validate(
        command({
          lines: [
            line({ lineNumber: 1 }),
            line({
              lineNumber: 2,
              discountAmount: '25.00000',
              discountCode: '06',
              discountNature: 'Promoción Inventori',
              taxAmount: '126.75000',
            }),
          ],
        }),
      ),
    ).not.toThrow();
  });

  it('rejects invalid discounts and missing discount metadata', () => {
    expectCode(
      command({ lines: [line({ discountAmount: '1.00000', taxAmount: '129.87000' })] }),
      'FISCAL_DISCOUNT_METADATA_REQUIRED',
    );
    expectCode(
      command({
        lines: [
          line({
            discountAmount: '1001.00000',
            discountCode: '07',
            discountNature: 'Descuento comercial Inventori',
          }),
        ],
      }),
      'INVALID_FISCAL_DISCOUNT_AMOUNT',
    );
    expectCode(
      command({
        lines: [
          line({
            discountAmount: '1.00000',
            discountCode: 'XX',
            discountNature: 'Descuento comercial Inventori',
          }),
        ],
      }),
      'INVALID_FISCAL_DISCOUNT_CODE',
    );
  });

  it('enforces CodigoDescuentoOTRO only for discount code 99', () => {
    expectCode(
      command({
        lines: [
          line({
            discountAmount: '1.00000',
            discountCode: '99',
            discountNature: 'Otro descuento',
          }),
        ],
      }),
      'FISCAL_DISCOUNT_OTHER_REQUIRED',
    );
    expectCode(
      command({
        lines: [
          line({
            discountAmount: '1.00000',
            discountCode: '07',
            discountNature: 'Descuento comercial',
            discountOther: 'No debe venir',
          }),
        ],
      }),
      'FISCAL_DISCOUNT_OTHER_NOT_ALLOWED',
    );
  });

  it('supports saleCondition 02 only with a valid document credit term and no payment method', () => {
    expect(() =>
      validate(command({ saleCondition: '02', creditTermDays: 30, paymentMethod: undefined })),
    ).not.toThrow();

    expectCode(
      command({ saleCondition: '02', paymentMethod: undefined }),
      'FISCAL_CREDIT_TERM_REQUIRED',
    );
    expectCode(
      command({ saleCondition: '02', creditTermDays: 0, paymentMethod: undefined }),
      'FISCAL_CREDIT_TERM_REQUIRED',
    );
    expectCode(
      command({ saleCondition: '02', creditTermDays: 30, paymentMethod: '01' }),
      'CREDIT_PAYMENT_METHOD_NOT_ALLOWED',
    );
  });

  it('keeps saleCondition 01 behavior unchanged and rejects inappropriate credit terms', () => {
    expect(() => validate(command({ saleCondition: '01', paymentMethod: '01' }))).not.toThrow();
    expectCode(
      command({ saleCondition: '01', creditTermDays: 30, paymentMethod: '01' }),
      'FISCAL_CREDIT_TERM_NOT_ALLOWED',
    );
    expectCode(
      command({ saleCondition: '01', paymentMethod: undefined }),
      'PAYMENT_METHOD_REQUIRED',
    );
  });

  it('accepts canonical Hacienda unit measures and rejects commercial/free-text units', () => {
    for (const unitMeasure of ['Unid', 'Kg', 'G', 'L', 'mL', 'M', 'Sp']) {
      expect(() => validate(command({ lines: [line({ unitMeasure })] }))).not.toThrow();
    }
    for (const unitMeasure of ['UN', 'KG', 'kg', 'ML', 'ml', 'box']) {
      expectCode(command({ lines: [line({ unitMeasure })] }), 'UNSUPPORTED_FISCAL_UNIT_MEASURE');
    }
  });

  it('accepts credit + discount + expanded unit combinations', () => {
    expect(() =>
      validate(
        command({
          saleCondition: '02',
          creditTermDays: 60,
          paymentMethod: undefined,
          lines: [
            line({
              unitMeasure: 'Kg',
              discountAmount: '100.00000',
              discountCode: '07',
              discountNature: 'Descuento comercial Inventori',
              taxAmount: '117.00000',
            }),
          ],
        }),
      ),
    ).not.toThrow();
  });
});
