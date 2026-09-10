import { Inject, Injectable } from '@nestjs/common';
import {
  HACIENDA_PORT,
  HaciendaPort,
  CabysItem,
} from '../../../../../infrastructure/integrations/hacienda/ports/hacienda.port';
import { CabysItemNotFoundException } from '../../../domain/exceptions/cabys-not-found.exception';

@Injectable()
export class GetCabysItemHandler {
  constructor(
    @Inject(HACIENDA_PORT)
    private readonly haciendaPort: HaciendaPort,
  ) {}

  async execute(code: string): Promise<CabysItem> {
    const item = await this.haciendaPort.getCabys(code);
    if (!item) {
      throw new CabysItemNotFoundException(code);
    }
    return item;
  }
}
