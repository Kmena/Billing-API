import { MockHaciendaAdapter } from '../adapters/mock-hacienda.adapter';

describe('MockHaciendaAdapter', () => {
  let adapter: MockHaciendaAdapter;

  beforeEach(() => {
    adapter = new MockHaciendaAdapter();
  });

  describe('getTaxpayer()', () => {
    it('returns a found taxpayer for a known identification', async () => {
      const result = await adapter.getTaxpayer('3101234567');
      expect(result.found).toBe(true);
      expect(result.identification).toBe('3101234567');
      expect(result.name).toBeDefined();
    });

    it('returns found=false for an unknown identification', async () => {
      const result = await adapter.getTaxpayer('9999999999');
      expect(result.found).toBe(false);
    });
  });

  describe('getExchangeRate()', () => {
    it('returns exchange rate with buyRate and sellRate for USD', async () => {
      const result = await adapter.getExchangeRate('USD', new Date());
      expect(result.currency).toBe('USD');
      expect(result.buyRate).toBeGreaterThan(0);
      expect(result.sellRate).toBeGreaterThan(result.buyRate);
      expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('returns rates for EUR', async () => {
      const result = await adapter.getExchangeRate('EUR', new Date());
      expect(result.currency).toBe('EUR');
      expect(result.sellRate).toBeDefined();
    });
  });

  describe('getCabys()', () => {
    it('returns a CABYS item for a known code', async () => {
      const result = await adapter.getCabys('5209900000000');
      expect(result).not.toBeNull();
      expect(result?.code).toBe('5209900000000');
      expect(result?.taxRate).toBeGreaterThan(0);
    });

    it('returns null for an unknown CABYS code', async () => {
      const result = await adapter.getCabys('0000000000000');
      expect(result).toBeNull();
    });
  });

  describe('searchCabys()', () => {
    it('returns matching items and total count', async () => {
      const result = await adapter.searchCabys('tecnología');
      expect(result.total).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(result.items)).toBe(true);
    });

    it('returns empty results for unmatched query', async () => {
      const result = await adapter.searchCabys('xyzabcnotfound');
      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  describe('submitDocument()', () => {
    it('returns accepted=true', async () => {
      const result = await adapter.submitDocument('<xml/>', 'mock-token');
      expect(result.accepted).toBe(true);
      expect(result.key).toBeDefined();
    });
  });

  describe('getDocumentStatus()', () => {
    it('returns ACCEPTED status', async () => {
      const result = await adapter.getDocumentStatus('mock-key', 'mock-token');
      expect(result.status).toBe('ACCEPTED');
      expect(result.key).toBe('mock-key');
    });
  });
});
