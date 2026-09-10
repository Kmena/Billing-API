import { Module } from '@nestjs/common';
import { HaciendaModule } from '../../infrastructure/integrations/hacienda/hacienda.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { GetTaxpayerHandler } from './application/use-cases/get-taxpayer/get-taxpayer.handler';
import { TaxpayerController } from './infrastructure/http/taxpayer.controller';

@Module({
  imports: [HaciendaModule, ApiKeysModule],
  providers: [GetTaxpayerHandler],
  controllers: [TaxpayerController],
})
export class TaxpayersModule {}
