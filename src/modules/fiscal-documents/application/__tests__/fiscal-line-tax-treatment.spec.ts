import { BadRequestException } from '@nestjs/common';
import { FiscalDocumentService, CreateFiscalDocumentCommand } from '../fiscal-document.service';
import { classifyFiscalLineTax } from '../../domain/fiscal-line-tax-treatment';
import { ScaledDecimal } from '../../domain/scaled-decimal';

const base = ScaledDecimal.from('10000.00000');
const exempt = { taxAmount: '0.00000', taxCode: '01', taxRateCode: '10', taxRate: '0' };
const zeroRated = { ...exempt, taxRateCode: '01' };
const standard = { taxAmount: '1300.00000', taxCode: '01', taxRateCode: '08', taxRate: '13' };

describe('explicit fiscal line tax treatment', () => {
  it('distinguishes exempt, zero-rated and 13% without inferring from zero alone', () => {
    expect(classifyFiscalLineTax(exempt, base)).toBe('EXEMPT');
    expect(classifyFiscalLineTax(zeroRated, base)).toBe('ZERO_RATED');
    expect(classifyFiscalLineTax(standard, base)).toBe('TAXED');
  });

  it('accepts two-decimal Hacienda rounding for an Afiliaciones 13% base', () => {
    expect(
      classifyFiscalLineTax({ ...standard, taxAmount: '1150.44' }, ScaledDecimal.from('8849.56')),
    ).toBe('TAXED');
  });

  it.each([
    [{ ...exempt, taxAmount: undefined }, 'FISCAL_XML_TAX_AMOUNT_REQUIRED'],
    [{ ...exempt, taxCode: undefined }, 'FISCAL_XML_TAX_METADATA_REQUIRED'],
    [{ ...exempt, taxRateCode: undefined }, 'FISCAL_XML_IVA_RATE_CODE_REQUIRED'],
    [{ ...exempt, taxRateCode: '99' }, 'FISCAL_XML_UNSUPPORTED_TAX_RATE_CODE'],
    [{ ...exempt, taxRateCode: '11' }, 'FISCAL_XML_UNSUPPORTED_ZERO_TAX_TREATMENT'],
    [{ ...exempt, taxRateCode: '08', taxRate: '13' }, 'FISCAL_XML_UNSUPPORTED_ZERO_TAX_TREATMENT'],
    [{ ...exempt, taxAmount: '1' }, 'FISCAL_XML_TAX_AMOUNT_RATE_MISMATCH'],
    [{ ...standard, taxAmount: '1299' }, 'FISCAL_XML_TAX_AMOUNT_RATE_MISMATCH'],
    [{ ...standard, taxRate: '4' }, 'FISCAL_XML_TAX_AMOUNT_RATE_MISMATCH'],
  ])('rejects ambiguous or contradictory tax data %#', (line, code) => {
    expect(() => classifyFiscalLineTax(line, base)).toThrow(code);
  });

  it('rejects a negative taxable base', () => {
    expect(() => classifyFiscalLineTax(exempt, ScaledDecimal.from('-1'))).toThrow(
      'FISCAL_XML_INVALID_BASE_AMOUNT',
    );
  });

  it('rejects ambiguous zero-tax requests before opening a persistence transaction', async () => {
    const prisma = { $transaction: jest.fn() };
    const service = new FiscalDocumentService(prisma as never, { record: jest.fn() } as never);
    const command: CreateFiscalDocumentCommand = {
      tenantId: '22222222-2222-4222-8222-222222222222',
      companyId: '33333333-3333-4333-8333-333333333333',
      environment: 'SANDBOX',
      type: 'INVOICE',
      receiver: {
        name: 'Cliente Sintético',
        identificationType: 'JURIDICA',
        identificationNumber: '3101000001',
        email: 'synthetic@example.test',
      },
      currency: 'CRC',
      saleCondition: '02',
      creditTermDays: 30,
      lines: [
        {
          lineNumber: 1,
          cabysCode: '8313100000100',
          description: 'Enero',
          unitMeasure: 'Sp',
          quantity: '1',
          unitPrice: '10000',
          taxAmount: '0',
        },
      ],
      apiKeyId: '44444444-4444-4444-8444-444444444444',
      idempotencyKey: 'r2-zero',
    };
    await expect(service.createDocument(command)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
