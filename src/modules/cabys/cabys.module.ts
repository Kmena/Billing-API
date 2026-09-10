import { Module } from '@nestjs/common';
import { HaciendaModule } from '../../infrastructure/integrations/hacienda/hacienda.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { GetCabysItemHandler } from './application/use-cases/get-cabys-item/get-cabys-item.handler';
import { SearchCabysHandler } from './application/use-cases/search-cabys/search-cabys.handler';
import { CabysController } from './infrastructure/http/cabys.controller';

@Module({
  imports: [HaciendaModule, ApiKeysModule],
  providers: [GetCabysItemHandler, SearchCabysHandler],
  controllers: [CabysController],
})
export class CabysModule {}
