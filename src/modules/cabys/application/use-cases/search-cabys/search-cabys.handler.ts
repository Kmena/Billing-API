import { Inject, Injectable } from '@nestjs/common';
import {
  HACIENDA_PORT,
  HaciendaPort,
  CabysSearchResult,
} from '../../../../../infrastructure/integrations/hacienda/ports/hacienda.port';

@Injectable()
export class SearchCabysHandler {
  constructor(
    @Inject(HACIENDA_PORT)
    private readonly haciendaPort: HaciendaPort,
  ) {}

  async execute(query: string, limit: number = 10): Promise<CabysSearchResult> {
    return this.haciendaPort.searchCabys(query, limit);
  }
}
