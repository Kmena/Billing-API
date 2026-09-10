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
 * MockHaciendaAdapter — Development/test implementation.
 * Returns predictable fixture data for all HaciendaPort methods.
 * ADR-004: Never uses real Hacienda connectivity.
 * Updated for Fase 1: includes all TaxpayerResult extended fields (OQ-RA-001).
 */
@Injectable()
export class MockHaciendaAdapter implements HaciendaPort {
  private readonly MOCK_TAXPAYERS: Record<string, TaxpayerResult> = {
    '3101234567': {
      identification: '3101234567',
      name: 'Empresa Demo S.A.',
      found: true,
      identificationType: '02',
      taxRegime: 'Régimen general',
      taxSituation: 'Inscrito',
      economicActivities: [
        {
          code: '6110.0',
          description: 'Actividades de telecomunicaciones alámbricas',
          status: 'A',
          type: 'P',
        },
      ],
    },
    '123456789': {
      identification: '123456789',
      name: 'Juan Demo Pérez',
      found: true,
      identificationType: '01',
      taxRegime: 'Régimen simplificado',
      taxSituation: 'Inscrito',
      economicActivities: [
        {
          code: '9609.0',
          description: 'Otras actividades de servicios personales n.c.p.',
          status: 'A',
          type: 'P',
        },
      ],
    },
    '4000042139': {
      identification: '4000042139',
      name: 'INSTITUTO COSTARRICENSE DE ELECTRICIDAD',
      found: true,
      identificationType: '02',
      taxRegime: 'Régimen general',
      taxSituation: 'Inscrito',
      economicActivities: [
        {
          code: '6110.0',
          description: 'Actividades de telecomunicaciones alámbricas',
          status: 'A',
          type: 'P',
        },
        {
          code: '3510.0',
          description: 'Generación, transmisión y distribución de energía eléctrica',
          status: 'A',
          type: 'S',
        },
      ],
    },
  };

  private readonly MOCK_CABYS: Record<string, CabysItem> = {
    '5209900000000': {
      code: '5209900000000',
      description: 'Mercancías de consumo corriente, n.e.p.',
      taxRate: 13,
      category: 'Mercancías de consumo corriente, n.e.p.',
    },
    '4909000000000': {
      code: '4909000000000',
      description: 'Servicios de tecnología de información',
      taxRate: 13,
      category: 'Servicios de tecnología de información',
    },
  };

  async getTaxpayer(identification: string): Promise<TaxpayerResult> {
    const taxpayer = this.MOCK_TAXPAYERS[identification];
    if (taxpayer) return taxpayer;

    return {
      identification,
      name: '',
      found: false,
    };
  }

  async getExchangeRate(currency: string, date: Date): Promise<ExchangeRateResult> {
    const rates: Record<string, { buy: number; sell: number }> = {
      USD: { buy: 515.5, sell: 519.5 },
      EUR: { buy: 558.3, sell: 562.3 },
    };

    const rate = rates[currency.toUpperCase()] ?? { buy: 500.0, sell: 510.0 };

    return {
      currency: currency.toUpperCase(),
      date: date.toISOString().split('T')[0],
      buyRate: rate.buy,
      sellRate: rate.sell,
    };
  }

  async getCabys(code: string): Promise<CabysItem | null> {
    return this.MOCK_CABYS[code] ?? null;
  }

  async searchCabys(query: string, limit: number = 10): Promise<CabysSearchResult> {
    const normalizedQuery = query.toLowerCase();
    const items = Object.values(this.MOCK_CABYS).filter(
      (item) =>
        item.description.toLowerCase().includes(normalizedQuery) || item.code.includes(query),
    );

    const sliced = items.slice(0, limit);

    return {
      items: sliced,
      total: items.length,
    };
  }

  async submitDocument(_xmlPayload: string, _accessToken: string): Promise<SubmissionResult> {
    return {
      accepted: true,
      key: `MOCK-${Date.now()}`,
      message: 'Document accepted by mock adapter',
    };
  }

  async getDocumentStatus(key: string, _accessToken: string): Promise<DocumentStatusResult> {
    return {
      key,
      status: 'ACCEPTED',
      message: 'Document accepted (mock)',
      haciendaTimestamp: new Date().toISOString(),
    };
  }
}
