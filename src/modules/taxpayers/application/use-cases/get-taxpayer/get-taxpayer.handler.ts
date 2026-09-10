import { Inject, Injectable } from '@nestjs/common';
import {
  HACIENDA_PORT,
  HaciendaPort,
  TaxpayerResult,
} from '../../../../../infrastructure/integrations/hacienda/ports/hacienda.port';

@Injectable()
export class GetTaxpayerHandler {
  constructor(
    @Inject(HACIENDA_PORT)
    private readonly haciendaPort: HaciendaPort,
  ) {}

  async execute(identification: string): Promise<TaxpayerResult> {
    return this.haciendaPort.getTaxpayer(identification);
  }
}
