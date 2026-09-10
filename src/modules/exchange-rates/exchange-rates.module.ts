import { Module } from '@nestjs/common';
import { HaciendaModule } from '../../infrastructure/integrations/hacienda/hacienda.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { GetExchangeRateHandler } from './application/use-cases/get-exchange-rate/get-exchange-rate.handler';
import { ExchangeRatesController } from './infrastructure/http/exchange-rates.controller';

@Module({
  imports: [HaciendaModule, ApiKeysModule],
  providers: [GetExchangeRateHandler],
  controllers: [ExchangeRatesController],
})
export class ExchangeRatesModule {}
