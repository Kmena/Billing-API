import { of, throwError } from 'rxjs';
import { HaciendaApiAdapter } from '../adapters/hacienda-api.adapter';
import { HaciendaUnavailableException } from '../exceptions/hacienda-unavailable.exception';
import { HaciendaCircuitBreaker } from '../hacienda-circuit-breaker.service';
import type { HttpService } from '@nestjs/axios';
import type { Cache } from 'cache-manager';
import type { ConfigService } from '@nestjs/config';

import * as taxpayerFisicaFixture from './fixtures/hacienda-taxpayer-fisica-response.json';
import * as taxpayerJuridicaFixture from './fixtures/hacienda-taxpayer-juridica-response.json';
import * as taxpayerNotFoundFixture from './fixtures/hacienda-taxpayer-notfound-response.json';
import * as exchangeRateFixture from './fixtures/hacienda-exchange-rate-response.json';
import * as cabysDirectFixture from './fixtures/hacienda-cabys-direct-response.json';
import * as cabysSearchFixture from './fixtures/hacienda-cabys-search-response.json';

function makeAdapter(httpGetMock: jest.Mock, cacheMock: Partial<Cache> = {}): HaciendaApiAdapter {
  const configService = {
    get: jest.fn().mockReturnValue({
      apiBaseUrl: 'https://api.hacienda.go.cr',
      timeoutMs: 10000,
      useReal: true,
      cache: {
        taxpayerTtlMs: 3600000,
        exchangeRateTtlMs: 14400000,
        cabysItemTtlMs: 86400000,
        cabysSearchTtlMs: 3600000,
      },
    }),
  } as unknown as ConfigService;

  const httpService = {
    get: httpGetMock,
  } as unknown as HttpService;

  const cache = {
    get: jest.fn().mockResolvedValue(undefined),
    set: jest.fn().mockResolvedValue(undefined),
    del: jest.fn(),
    wrap: jest.fn(),
    ...cacheMock,
  } as unknown as Cache;

  // Use a passthrough circuit breaker for unit tests
  const circuitBreaker = {
    execute: jest.fn().mockImplementation(async (fn: () => Promise<unknown>) => fn()),
  } as unknown as HaciendaCircuitBreaker;

  return new HaciendaApiAdapter(configService, httpService, cache, circuitBreaker);
}

describe('HaciendaApiAdapter', () => {
  describe('getTaxpayer() — FISICA fixture (OQ-RA-001)', () => {
    it('maps FISICA taxpayer response to TaxpayerResult', async () => {
      const getMock = jest.fn().mockReturnValue(of({ data: taxpayerFisicaFixture }));
      const adapter = makeAdapter(getMock);

      const result = await adapter.getTaxpayer('207530251');

      expect(result.found).toBe(true);
      expect(result.name).toBe('PERSONA FISICA DEMO');
      expect(result.identificationType).toBe('01');
      expect(result.taxRegime).toBe('Régimen general');
      expect(result.taxSituation).toBe('Inscrito');
      expect(result.economicActivities).toHaveLength(1);
      expect(result.economicActivities![0].code).toBe('9609.0');
      expect(result.economicActivities![0].type).toBe('P');
      // email and commercialName NOT populated from /fe/ae
      expect(result.email).toBeUndefined();
      expect(result.commercialName).toBeUndefined();
    });
  });

  describe('getTaxpayer() — JURIDICA fixture (OQ-RA-001)', () => {
    it('maps JURIDICA taxpayer (ICE) with multiple activities', async () => {
      const getMock = jest.fn().mockReturnValue(of({ data: taxpayerJuridicaFixture }));
      const adapter = makeAdapter(getMock);

      const result = await adapter.getTaxpayer('4000042139');

      expect(result.found).toBe(true);
      expect(result.name).toBe('INSTITUTO COSTARRICENSE DE ELECTRICIDAD');
      expect(result.identificationType).toBe('02');
      expect(result.economicActivities).toHaveLength(3);
      expect(result.economicActivities![0].type).toBe('P'); // principal
      expect(result.economicActivities![1].type).toBe('S'); // secondary
    });
  });

  describe('getTaxpayer() — not-found detection (BR-014)', () => {
    it('returns found=false when body contains code=404 (NOT HTTP 404 status)', async () => {
      // CRITICAL: Hacienda returns HTTP 200 with body {code: 404}
      const getMock = jest.fn().mockReturnValue(of({ data: taxpayerNotFoundFixture }));
      const adapter = makeAdapter(getMock);

      const result = await adapter.getTaxpayer('9999999999');

      expect(result.found).toBe(false);
      expect(result.name).toBe('');
      expect(result.identification).toBe('9999999999');
      // Must NOT throw HaciendaUnavailableException for not-found
    });

    it('caches not-found result', async () => {
      const getMock = jest.fn().mockReturnValue(of({ data: taxpayerNotFoundFixture }));
      const setCacheMock = jest.fn().mockResolvedValue(undefined);
      const adapter = makeAdapter(getMock, {
        get: jest.fn().mockResolvedValue(undefined),
        set: setCacheMock,
      });

      await adapter.getTaxpayer('9999999999');

      expect(setCacheMock).toHaveBeenCalledWith(
        'taxpayer:9999999999',
        expect.objectContaining({ found: false }),
        3600000,
      );
    });
  });

  describe('getTaxpayer() — cache behaviour (AC-017)', () => {
    it('returns cached result without calling HTTP service', async () => {
      const cachedResult = { identification: '123', name: 'Cached', found: true };
      const getMock = jest.fn();
      const adapter = makeAdapter(getMock, {
        get: jest.fn().mockResolvedValue(cachedResult),
        set: jest.fn().mockResolvedValue(undefined),
      });

      const result = await adapter.getTaxpayer('123');

      expect(result).toBe(cachedResult);
      expect(getMock).not.toHaveBeenCalled(); // No HTTP call — cache hit
    });
  });

  describe('getTaxpayer() — error handling', () => {
    it('throws HaciendaUnavailableException on network error', async () => {
      const getMock = jest.fn().mockReturnValue(throwError(() => new Error('Network error')));
      const adapter = makeAdapter(getMock);

      await expect(adapter.getTaxpayer('123456789')).rejects.toBeInstanceOf(
        HaciendaUnavailableException,
      );
    });
  });

  describe('getExchangeRate() — fixture (OQ-RA-002)', () => {
    it('maps exchange rate response to Billing-owned field names', async () => {
      const getMock = jest.fn().mockReturnValue(of({ data: exchangeRateFixture }));
      const adapter = makeAdapter(getMock);

      const result = await adapter.getExchangeRate('USD', new Date('2025-01-13'));

      // Confirmed field mapping: venta.valor → sellRate, compra.valor → buyRate
      expect(result.currency).toBe('USD');
      expect(result.sellRate).toBe(519.5); // venta.valor
      expect(result.buyRate).toBe(515.5); // compra.valor
      expect(result.date).toBe('2025-01-13'); // venta.fecha
    });

    it('calls current endpoint for today, historico endpoint for past dates', async () => {
      const getMock = jest.fn().mockReturnValue(of({ data: exchangeRateFixture }));
      const adapter = makeAdapter(getMock);

      const today = new Date();
      await adapter.getExchangeRate('USD', today);
      expect(getMock.mock.calls[0][0]).toContain('/indicadores/tc/dolar');
      expect(getMock.mock.calls[0][0]).not.toContain('historico');

      getMock.mockClear();
      const pastDate = new Date('2024-01-01');
      await adapter.getExchangeRate('USD', pastDate);
      expect(getMock.mock.calls[0][0]).toContain('historico');
    });
  });

  describe('getCabys() — fixture (OQ-RA-003)', () => {
    it('maps CABYS direct response to CabysItem', async () => {
      const getMock = jest.fn().mockReturnValue(of({ data: cabysDirectFixture }));
      const adapter = makeAdapter(getMock);

      const result = await adapter.getCabys('5209900000000');

      expect(result).not.toBeNull();
      expect(result!.code).toBe('5209900000000');
      expect(result!.description).toBe('Mercancías de consumo corriente, n.e.p.');
      expect(result!.taxRate).toBe(13);
      expect(result!.category).toBe('Mercancías de consumo corriente, n.e.p.'); // LAST breadcrumb
    });

    it('returns null when Hacienda returns empty array', async () => {
      const getMock = jest.fn().mockReturnValue(of({ data: [] }));
      const adapter = makeAdapter(getMock);

      const result = await adapter.getCabys('0000000000000');
      expect(result).toBeNull();
    });

    it('returns cached null without hitting Hacienda (AUD-KD-001 regression)', async () => {
      // AUD-KD-001: null must be treated as a valid cache hit (not-found result is cached too)
      const getMock = jest.fn();
      const adapter = makeAdapter(getMock, {
        // Cache returns null — means "not found" was cached previously
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue(undefined),
      });

      const result = await adapter.getCabys('0000000000000');

      expect(result).toBeNull();
      // The HTTP service must NOT be called — cached null is a valid cache hit
      expect(getMock).not.toHaveBeenCalled();
    });

    it('caches null result when code is not found in Hacienda', async () => {
      const getMock = jest.fn().mockReturnValue(of({ data: [] }));
      const setCacheMock = jest.fn().mockResolvedValue(undefined);
      const adapter = makeAdapter(getMock, {
        get: jest.fn().mockResolvedValue(undefined),
        set: setCacheMock,
      });

      await adapter.getCabys('0000000000000');

      expect(setCacheMock).toHaveBeenCalledWith('cabys:code:0000000000000', null, 86400000);
    });

    it('calls correct URL with ?codigo= parameter', async () => {
      const getMock = jest.fn().mockReturnValue(of({ data: cabysDirectFixture }));
      const adapter = makeAdapter(getMock);

      await adapter.getCabys('5209900000000');
      expect(getMock.mock.calls[0][0]).toContain('?codigo=5209900000000');
    });
  });

  describe('searchCabys() — fixture (OQ-RA-003)', () => {
    it('maps CABYS search response correctly', async () => {
      const getMock = jest.fn().mockReturnValue(of({ data: cabysSearchFixture }));
      const adapter = makeAdapter(getMock);

      const result = await adapter.searchCabys('mercancia', 5);

      expect(result.total).toBe(1199); // total (NOT cantidad=3)
      expect(result.items).toHaveLength(2); // items in this page
      // uri and estado NOT in CabysItem
      const item = result.items[0] as unknown as Record<string, unknown>;
      expect(item['uri']).toBeUndefined();
      expect(item['estado']).toBeUndefined();
    });

    it('calls correct URL with ?q= and &top= parameters (OQ-RA-003)', async () => {
      const getMock = jest.fn().mockReturnValue(of({ data: cabysSearchFixture }));
      const adapter = makeAdapter(getMock);

      await adapter.searchCabys('servicios', 15);
      const url = getMock.mock.calls[0][0] as string;
      expect(url).toContain('?q=servicios');
      expect(url).toContain('&top=15');
      // Must NOT use ?query= or ?limit=
      expect(url).not.toContain('query=');
      expect(url).not.toContain('limit=');
    });

    it('category is the LAST breadcrumb element (most specific)', async () => {
      const getMock = jest.fn().mockReturnValue(of({ data: cabysSearchFixture }));
      const adapter = makeAdapter(getMock);

      const result = await adapter.searchCabys('mercancia', 5);
      expect(result.items[0].category).toBe('Mercancías de consumo corriente'); // last in array
    });
  });
});
