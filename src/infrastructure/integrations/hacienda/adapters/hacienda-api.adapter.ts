import { Inject, Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { firstValueFrom } from 'rxjs';
import {
  CabysItem,
  CabysSearchResult,
  DocumentStatusResult,
  ExchangeRateResult,
  HaciendaPort,
  SubmissionResult,
  TaxpayerResult,
} from '../ports/hacienda.port';
import { HaciendaUnavailableException } from '../exceptions/hacienda-unavailable.exception';
import { HaciendaCircuitBreaker } from '../hacienda-circuit-breaker.service';

// ─── Private Hacienda DTOs — NEVER export outside this file ──────────────────
// BR-012: Hacienda field names (nombre, venta, compra, codigo, impuesto, etc.)
// are confined to this adapter only.

interface HaciendaTaxpayerDto {
  nombre: string;
  tipoIdentificacion: string;
  regimen: { codigo: number; descripcion: string };
  situacion: {
    moroso: string;
    omiso: string;
    estado: string;
    administracionTributaria: string;
  };
  actividades: Array<{
    estado: string;
    tipo: string;
    codigo: string; // activity code e.g. "9609.0" — NOT a CABYS 13-digit code (BR-015)
    descripcion: string;
  }>;
}

// ⚠️ CRITICAL (BR-014): Hacienda returns HTTP 200 for not-found taxpayer
// with body { code: 404, status: "..." } — NOT an HTTP 404 status.
interface HaciendaNotFoundDto {
  code: 404;
  status: string;
}

type HaciendaTaxpayerResponseDto = HaciendaTaxpayerDto | HaciendaNotFoundDto;

interface HaciendaExchangeRateDto {
  venta: { valor: number; fecha: string };
  compra: { valor: number; fecha: string };
}

type HaciendaCabysDirectDto = Array<{
  categorias: string[];
  codigo: string;
  descripcion: string;
  impuesto: number;
}>;

interface HaciendaCabysSearchDto {
  total: number; // total matching records (use this, NOT cantidad)
  cantidad: number; // items in THIS page only — do NOT use for total
  cabys: Array<{
    categorias: string[];
    codigo: string;
    descripcion: string;
    impuesto: number;
    uri: string; // NOT in Billing contract
    estado: string; // NOT in Billing contract
  }>;
}

// ─── Hacienda adapter config type ────────────────────────────────────────────
interface HaciendaConfig {
  apiBaseUrl: string;
  timeoutMs: number;
  useReal: boolean;
  cache: {
    taxpayerTtlMs: number;
    exchangeRateTtlMs: number;
    cabysItemTtlMs: number;
    cabysSearchTtlMs: number;
  };
}

/**
 * HaciendaApiAdapter — Real HTTP implementation of HaciendaPort.
 * Uses @nestjs/axios for HTTP, cache-manager for TTL caching,
 * and HaciendaCircuitBreaker for outbound traffic protection.
 *
 * BR-002/FR-017: All field mapping from Hacienda to Billing-owned names is here only.
 * BR-012: No Hacienda field names appear outside private methods and fixture files.
 * BR-014: Taxpayer not-found detected via body inspection (not HTTP 404 status).
 */
@Injectable()
export class HaciendaApiAdapter implements HaciendaPort {
  private readonly logger = new Logger(HaciendaApiAdapter.name);
  private readonly config: HaciendaConfig;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly circuitBreaker: HaciendaCircuitBreaker,
  ) {
    this.config = this.configService.get<HaciendaConfig>('hacienda') ?? {
      apiBaseUrl: 'https://api.hacienda.go.cr',
      timeoutMs: 10000,
      useReal: false,
      cache: {
        taxpayerTtlMs: 3600000,
        exchangeRateTtlMs: 14400000,
        cabysItemTtlMs: 86400000,
        cabysSearchTtlMs: 3600000,
      },
    };
  }

  // ─── TASK-007: getTaxpayer ────────────────────────────────────────────────

  async getTaxpayer(identification: string): Promise<TaxpayerResult> {
    const cacheKey = `taxpayer:${identification}`;
    const cached = await this.cache.get<TaxpayerResult>(cacheKey);
    if (cached) return cached;

    const url = `${this.config.apiBaseUrl}/fe/ae?identificacion=${identification}`;
    const ttlMs = this.config.cache.taxpayerTtlMs;

    try {
      const data = await this.circuitBreaker.execute(() =>
        firstValueFrom(
          this.httpService.get<HaciendaTaxpayerResponseDto>(url, {
            timeout: this.config.timeoutMs,
          }),
        ).then((r) => r.data),
      );

      // BR-014: Hacienda returns HTTP 200 for not-found — check body, NOT HTTP status
      if (this.isHaciendaNotFound(data)) {
        const notFound: TaxpayerResult = { identification, name: '', found: false };
        await this.cache.set(cacheKey, notFound, ttlMs);
        return notFound;
      }

      const result = this.mapTaxpayerResponse(identification, data as HaciendaTaxpayerDto);
      await this.cache.set(cacheKey, result, ttlMs);
      return result;
    } catch (err) {
      if (err instanceof HaciendaUnavailableException) throw err;
      this.logger.warn(
        { identification, error: err instanceof Error ? err.message : String(err) },
        'Hacienda getTaxpayer failed',
      );
      throw new HaciendaUnavailableException('getTaxpayer');
    }
  }

  // BR-014: Body discriminator — MUST check body.code, NOT HTTP status
  private isHaciendaNotFound(data: unknown): data is HaciendaNotFoundDto {
    return (
      typeof data === 'object' &&
      data !== null &&
      'code' in data &&
      (data as HaciendaNotFoundDto).code === 404
    );
  }

  private mapTaxpayerResponse(identification: string, data: HaciendaTaxpayerDto): TaxpayerResult {
    return {
      identification,
      name: data.nombre,
      found: true,
      identificationType: data.tipoIdentificacion,
      taxRegime: data.regimen.descripcion,
      taxSituation: data.situacion.estado,
      economicActivities: data.actividades.map((a) => ({
        code: a.codigo, // activity code "9609.0" — NOT a CABYS code (BR-015)
        description: a.descripcion,
        status: a.estado, // "A" | "I"
        type: a.tipo, // "P" | "S"
      })),
      // email, commercialName: NOT in /fe/ae response — undefined (FR-001)
    };
  }

  // ─── TASK-008: getExchangeRate ────────────────────────────────────────────

  async getExchangeRate(currency: string, date: Date): Promise<ExchangeRateResult> {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const requestDate = new Date(date);
    requestDate.setUTCHours(0, 0, 0, 0);

    const dateStr = requestDate.toISOString().split('T')[0];
    const cacheKey = `exchange-rate:${currency.toUpperCase()}:${dateStr}`;
    const cached = await this.cache.get<ExchangeRateResult>(cacheKey);
    if (cached) return cached;

    const isHistorical = requestDate < today;
    const url = isHistorical
      ? `${this.config.apiBaseUrl}/indicadores/tc/dolar/historico?d=${dateStr}&h=${dateStr}`
      : `${this.config.apiBaseUrl}/indicadores/tc/dolar`;

    const ttlMs = this.config.cache.exchangeRateTtlMs;

    try {
      const data = await this.circuitBreaker.execute(() =>
        firstValueFrom(
          this.httpService.get<HaciendaExchangeRateDto>(url, {
            timeout: this.config.timeoutMs,
          }),
        ).then((r) => r.data),
      );

      const result = this.mapExchangeRateResponse(currency.toUpperCase(), data);
      await this.cache.set(cacheKey, result, ttlMs);
      return result;
    } catch (err) {
      if (err instanceof HaciendaUnavailableException) throw err;
      this.logger.warn(
        { currency, date: dateStr, error: err instanceof Error ? err.message : String(err) },
        'Hacienda getExchangeRate failed',
      );
      throw new HaciendaUnavailableException('getExchangeRate');
    }
  }

  private mapExchangeRateResponse(
    currency: string,
    data: HaciendaExchangeRateDto,
  ): ExchangeRateResult {
    // OQ-RA-002 confirmed field names:
    // venta.valor → sellRate, compra.valor → buyRate, venta.fecha → date
    return {
      currency,
      date: data.venta.fecha,
      sellRate: data.venta.valor,
      buyRate: data.compra.valor,
    };
  }

  // ─── TASK-009: getCabys & searchCabys ────────────────────────────────────

  async getCabys(code: string): Promise<CabysItem | null> {
    const cacheKey = `cabys:code:${code}`;
    const cached = await this.cache.get<CabysItem | null>(cacheKey);
    // AUD-KD-001: use strict undefined check — cached null IS a valid cache hit (not-found result)
    if (cached !== undefined) return cached;

    const url = `${this.config.apiBaseUrl}/fe/cabys?codigo=${code}`;
    const ttlMs = this.config.cache.cabysItemTtlMs;

    try {
      const data = await this.circuitBreaker.execute(() =>
        firstValueFrom(
          this.httpService.get<HaciendaCabysDirectDto>(url, {
            timeout: this.config.timeoutMs,
          }),
        ).then((r) => r.data),
      );

      // Direct lookup returns ARRAY — empty = not found (OQ-RA-003)
      if (!data || data.length === 0) {
        await this.cache.set(cacheKey, null, ttlMs);
        return null;
      }

      const item = this.mapCabysItem(data[0]);
      await this.cache.set(cacheKey, item, ttlMs);
      return item;
    } catch (err) {
      if (err instanceof HaciendaUnavailableException) throw err;
      this.logger.warn(
        { code, error: err instanceof Error ? err.message : String(err) },
        'Hacienda getCabys failed',
      );
      throw new HaciendaUnavailableException('getCabys');
    }
  }

  async searchCabys(query: string, limit: number = 10): Promise<CabysSearchResult> {
    const cacheKey = `cabys:search:${query.toLowerCase()}:${limit}`;
    const cached = await this.cache.get<CabysSearchResult>(cacheKey);
    if (cached) return cached;

    // OQ-RA-003: search parameter is 'q' (not 'query'), limit is 'top' (not 'limit')
    const url = `${this.config.apiBaseUrl}/fe/cabys?q=${encodeURIComponent(query)}&top=${limit}`;
    const ttlMs = this.config.cache.cabysSearchTtlMs;

    try {
      const data = await this.circuitBreaker.execute(() =>
        firstValueFrom(
          this.httpService.get<HaciendaCabysSearchDto>(url, {
            timeout: this.config.timeoutMs,
          }),
        ).then((r) => r.data),
      );

      // OQ-RA-003: use 'total' NOT 'cantidad' for the total count
      const result: CabysSearchResult = {
        items: data.cabys.map((item) => this.mapCabysItem(item)),
        total: data.total,
      };

      await this.cache.set(cacheKey, result, ttlMs);
      return result;
    } catch (err) {
      if (err instanceof HaciendaUnavailableException) throw err;
      this.logger.warn(
        { query, limit, error: err instanceof Error ? err.message : String(err) },
        'Hacienda searchCabys failed',
      );
      throw new HaciendaUnavailableException('searchCabys');
    }
  }

  private mapCabysItem(dto: {
    categorias: string[];
    codigo: string;
    descripcion: string;
    impuesto: number;
  }): CabysItem {
    return {
      code: dto.codigo,
      description: dto.descripcion,
      taxRate: dto.impuesto,
      category: dto.categorias[dto.categorias.length - 1], // LAST breadcrumb = most specific
    };
  }

  // ─── Fase 2+ stubs ────────────────────────────────────────────────────────

  async submitDocument(_xmlPayload: string, _accessToken: string): Promise<SubmissionResult> {
    throw new Error('HaciendaApiAdapter.submitDocument: Not implemented — available in Fase 2.');
  }

  async getDocumentStatus(_key: string, _accessToken: string): Promise<DocumentStatusResult> {
    throw new Error('HaciendaApiAdapter.getDocumentStatus: Not implemented — available in Fase 2.');
  }
}
