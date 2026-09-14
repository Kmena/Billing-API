import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseEnumPipe,
  Post,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../../../api/guards/jwt-auth.guard';
import type { JwtRequest } from '../../../../api/strategies/jwt.strategy';
import type {
  HaciendaConnection,
  HaciendaEnvironment,
} from '../../domain/entities/hacienda-connection.entity';
import { ConfigureConnectionHandler } from '../../application/use-cases/configure-connection/configure-connection.handler';
import { GetConnectionHandler } from '../../application/use-cases/get-connection/get-connection.handler';
import { ValidateConnectionHandler } from '../../application/use-cases/validate-connection/validate-connection.handler';
import { DisableConnectionHandler } from '../../application/use-cases/disable-connection/disable-connection.handler';
import { ConfigureConnectionRequestDto } from './dtos/configure-connection.request.dto';
import { HaciendaConnectionResponseDto } from './dtos/hacienda-connection.response.dto';

const environments = { PRODUCTION: 'PRODUCTION', SANDBOX: 'SANDBOX' } as const;
@ApiTags('Hacienda Connection')
@SkipThrottle()
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('companies/:companyId/hacienda-connection/:environment')
export class HaciendaConnectionController {
  constructor(
    private readonly configure: ConfigureConnectionHandler,
    private readonly getConnection: GetConnectionHandler,
    private readonly validate: ValidateConnectionHandler,
    private readonly disable: DisableConnectionHandler,
  ) {}
  @Put() @ApiOkResponse({ type: HaciendaConnectionResponseDto }) async put(
    @Request() req: { user: JwtRequest },
    @Param('companyId') companyId: string,
    @Param('environment', new ParseEnumPipe(environments)) environment: HaciendaEnvironment,
    @Body() body: ConfigureConnectionRequestDto,
  ) {
    const connection = await this.configure.execute({
      tenantId: req.user.tenantId,
      companyId,
      environment,
      ...body,
    });
    return this.toResponseDto(connection);
  }
  @Get() @ApiOkResponse({ type: HaciendaConnectionResponseDto }) async get(
    @Param('companyId') companyId: string,
    @Param('environment', new ParseEnumPipe(environments)) environment: HaciendaEnvironment,
  ) {
    const result = await this.getConnection.execute(companyId, environment);
    if (!result) throw new NotFoundException({ code: 'HACIENDA_CONNECTION_NOT_FOUND' });
    return this.toResponseDto(result);
  }
  @Post('validate')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: HaciendaConnectionResponseDto })
  async postValidate(
    @Request() req: { user: JwtRequest },
    @Param('companyId') companyId: string,
    @Param('environment', new ParseEnumPipe(environments)) environment: HaciendaEnvironment,
  ) {
    const connection = await this.validate.execute(req.user.tenantId, companyId, environment);
    return this.toResponseDto(connection);
  }
  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: HaciendaConnectionResponseDto })
  async delete(
    @Request() req: { user: JwtRequest },
    @Param('companyId') companyId: string,
    @Param('environment', new ParseEnumPipe(environments)) environment: HaciendaEnvironment,
  ) {
    const connection = await this.disable.execute(req.user.tenantId, companyId, environment);
    return this.toResponseDto(connection);
  }

  private toResponseDto(connection: HaciendaConnection): HaciendaConnectionResponseDto {
    return {
      id: connection.id,
      tenantId: connection.tenantId,
      companyId: connection.companyId,
      environment: connection.environment,
      status: connection.status,
      lastValidatedAt: connection.lastValidatedAt,
      lastSuccessfulAuthAt: connection.lastSuccessfulAuthAt,
      lastValidationErrorCode: connection.lastValidationErrorCode,
      createdAt: connection.createdAt,
      updatedAt: connection.updatedAt,
    };
  }
}
