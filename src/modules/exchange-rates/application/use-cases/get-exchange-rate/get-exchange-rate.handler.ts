import { Inject, Injectable } from '@nestjs/common';
import {
  HACIENDA_PORT,
  HaciendaPort,
  ExchangeRateResult,
} from '../../../../../infrastructure/integrations/hacienda/ports/hacienda.port';

export interface GetExchangeRateQuery {
  readonly currency?: string;
  readonly date?: string; // YYYY-MM-DD or undefined (defaults to today)
}

@Injectable()
export class GetExchangeRateHandler {
  constructor(
    @Inject(HACIENDA_PORT)
    private readonly haciendaPort: HaciendaPort,
  ) {}

  async execute(query: GetExchangeRateQuery): Promise<ExchangeRateResult> {
    const currency = query.currency ?? 'USD';
    const date = query.date ? new Date(query.date) : new Date();
    return this.haciendaPort.getExchangeRate(currency, date);
  }
}
