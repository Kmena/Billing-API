import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { HandleHaciendaCallbackService } from '../../application/submission/handle-hacienda-callback.service';

@ApiTags('Hacienda Callback')
@Controller('hacienda/callback')
export class HaciendaCallbackController {
  constructor(private readonly callbackService: HandleHaciendaCallbackService) {}

  @Post()
  @HttpCode(200)
  async handleCallback(@Body() body: Record<string, unknown>) {
    return this.callbackService.execute(body);
  }
}
