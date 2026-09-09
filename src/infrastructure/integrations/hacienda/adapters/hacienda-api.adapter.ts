import { Injectable } from '@nestjs/common';
import {
  CabysItem,
  CabysSearchResult,
  DocumentStatusResult,
  ExchangeRateResult,
  HaciendaPort,
  SubmissionResult,
  TaxpayerResult,
} from '../ports/hacienda.port';

/**
 * HaciendaApiAdapter — Production stub for Fase 0.
 * Real implementation deferred to Fase 1 (queries) and Fase 2 (document submission).
 * ADR-004: Defined here so the interface contract is locked before Fase 1.
 *
 * Real Hacienda API URLs (only in this adapter, never in domain/application):
 * - https://api.hacienda.go.cr/fe/ae — taxpayer lookup
 * - https://tipodecambio.hacienda.go.cr/api — exchange rates
 * - https://www.hacienda.go.cr/ATV/ComprobanteElectronico/qr.aspx — CABYS
 */
@Injectable()
export class HaciendaApiAdapter implements HaciendaPort {
  async getTaxpayer(_identification: string): Promise<TaxpayerResult> {
    throw new Error('HaciendaApiAdapter.getTaxpayer: Not implemented — available in Fase 1.');
  }

  async getExchangeRate(_currency: string, _date: Date): Promise<ExchangeRateResult> {
    throw new Error('HaciendaApiAdapter.getExchangeRate: Not implemented — available in Fase 1.');
  }

  async getCabys(_code: string): Promise<CabysItem | null> {
    throw new Error('HaciendaApiAdapter.getCabys: Not implemented — available in Fase 1.');
  }

  async searchCabys(_query: string, _limit?: number): Promise<CabysSearchResult> {
    throw new Error('HaciendaApiAdapter.searchCabys: Not implemented — available in Fase 1.');
  }

  async submitDocument(_xmlPayload: string, _accessToken: string): Promise<SubmissionResult> {
    throw new Error('HaciendaApiAdapter.submitDocument: Not implemented — available in Fase 2.');
  }

  async getDocumentStatus(_key: string, _accessToken: string): Promise<DocumentStatusResult> {
    throw new Error('HaciendaApiAdapter.getDocumentStatus: Not implemented — available in Fase 2.');
  }
}
