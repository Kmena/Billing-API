import { buildConsecutive, buildFiscalKey } from '../fiscal-key.generator';

describe('Fiscal key generation v4.4', () => {
  it('builds the official 20-digit consecutive for invoices', () => {
    expect(
      buildConsecutive({
        branchCode: '001',
        terminalCode: '00001',
        documentType: 'INVOICE',
        sequenceValue: 25n,
      }),
    ).toBe('00100001010000000025');
  });

  it('builds a 50-digit clave with normalized 12-digit issuer id and normal situation', () => {
    const clave = buildFiscalKey({
      issuedAt: new Date('2026-09-11T12:00:00Z'),
      issuerIdentificationNumber: '3101123456',
      consecutive: '00100001010000000025',
      securityCode: '12345678',
    });

    expect(clave).toBe('50611092600310112345600100001010000000025112345678');
    expect(clave).toHaveLength(50);
  });
});
