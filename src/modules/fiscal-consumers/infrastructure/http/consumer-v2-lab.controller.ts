import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../../../api/guards/jwt-auth.guard';
import { TenantAdminGuard } from '../../../../api/guards/tenant-admin.guard';
import type { JwtRequest } from '../../../../api/strategies/jwt.strategy';
import { ConsumerV2LabService } from '../../application/consumer-v2-lab.service';
import { FiscalEnvironmentV2 } from '../../domain/consumer-v2.policy';
import { ConsumerV2Guard, ConsumerV2Principal } from './consumer-v2.guard';
import { ConsumerV2RequiredScope } from './consumer-v2-scope.decorator';
import {
  CreateConsumerAssociationV2Dto,
  CreateConsumerKeyV2Dto,
  LookupConsumerOperationV2Dto,
  ReassignConsumerIssuerV2Dto,
} from './consumer-v2.dto';

function correlationId(header: string | undefined): string {
  if (!header) return randomUUID();
  if (!/^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(header)) {
    throw new BadRequestException({ code: 'CORRELATION_ID_INVALID' });
  }
  return header;
}

function environment(value: string): FiscalEnvironmentV2 {
  if (value !== 'SANDBOX' && value !== 'PRODUCTION') {
    throw new BadRequestException({ code: 'CONSUMER_ENVIRONMENT_INVALID' });
  }
  return value;
}

/** Only FiscalConsumersLabModule registers these routes; AppModule does not import it. */
@UseGuards(JwtAuthGuard, TenantAdminGuard)
@Controller('api/v2/integrations/consumers')
export class ConsumerV2LabAdminController {
  constructor(private readonly service: ConsumerV2LabService) {}

  @Post()
  async register(
    @Req() req: { user: JwtRequest },
    @Body() body: CreateConsumerAssociationV2Dto,
    @Headers('x-correlation-id') requestedCorrelationId: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.service.registerAssociation({
      tenantId: req.user.tenantId,
      companyId: body.companyId,
      provider: body.provider,
      externalConsumerKey: body.externalConsumerKey,
      externalCompanyKey: body.externalCompanyKey,
      environment: body.environment,
      actorId: req.user.userId,
      correlationId: correlationId(requestedCorrelationId),
    });
    response.status(result.created ? 201 : 200).setHeader('Cache-Control', 'no-store');
    const { created: _created, ...association } = result;
    return association;
  }

  @Get(':consumerId')
  getConsumer(
    @Req() req: { user: JwtRequest },
    @Param('consumerId', ParseUUIDPipe) consumerId: string,
  ) {
    return this.service.getConsumer(req.user.tenantId, consumerId);
  }

  @Post(':consumerId/associations/:associationId/reassign')
  async reassignIssuer(
    @Req() req: { user: JwtRequest },
    @Param('consumerId', ParseUUIDPipe) consumerId: string,
    @Param('associationId', ParseUUIDPipe) associationId: string,
    @Body() body: ReassignConsumerIssuerV2Dto,
    @Headers('x-correlation-id') requestedCorrelationId: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.service.reassignIssuer({
      tenantId: req.user.tenantId,
      consumerId,
      associationId,
      targetCompanyId: body.targetCompanyId,
      newExternalCompanyKey: body.newExternalCompanyKey,
      actorId: req.user.userId,
      correlationId: correlationId(requestedCorrelationId),
    });
    response.setHeader('Cache-Control', 'no-store');
    return result;
  }

  @Post(':consumerId/keys')
  async issueKey(
    @Req() req: { user: JwtRequest },
    @Param('consumerId', ParseUUIDPipe) consumerId: string,
    @Body() body: CreateConsumerKeyV2Dto,
    @Headers('x-correlation-id') requestedCorrelationId: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const issued = await this.service.issueKey({
      tenantId: req.user.tenantId,
      consumerId,
      associationId: body.associationId,
      scopes: body.scopes,
      expiresAt: new Date(body.expiresAt),
      rotationEndsAt: body.rotationEndsAt ? new Date(body.rotationEndsAt) : undefined,
      actorId: req.user.userId,
      correlationId: correlationId(requestedCorrelationId),
    });
    response.setHeader('Cache-Control', 'no-store');
    const { apiKeyId, ...rest } = issued;
    return { keyId: apiKeyId, ...rest };
  }

  @Post(':consumerId/keys/:keyId/revoke')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeKey(
    @Req() req: { user: JwtRequest },
    @Param('consumerId', ParseUUIDPipe) consumerId: string,
    @Param('keyId', ParseUUIDPipe) keyId: string,
    @Headers('x-correlation-id') requestedCorrelationId: string | undefined,
  ) {
    await this.service.revokeKey({
      tenantId: req.user.tenantId,
      consumerId,
      apiKeyId: keyId,
      actorId: req.user.userId,
      correlationId: correlationId(requestedCorrelationId),
    });
  }
}

@UseGuards(ConsumerV2Guard)
@Controller('api/v2/companies/:companyId/fiscal-readiness/:environment')
export class ConsumerV2LabReadinessController {
  @Get()
  @ConsumerV2RequiredScope('fiscal-v2:readiness:read')
  getReadiness(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('environment') requestedEnvironment: string,
  ) {
    return {
      companyId,
      environment: environment(requestedEnvironment),
      ready: false,
      blockers: [{ code: 'W1_LAB_FISCAL_ISSUANCE_DISABLED' }],
    };
  }
}

@UseGuards(ConsumerV2Guard)
@Controller('api/v2/companies/:companyId/fiscal-documents/:environment/operations')
export class ConsumerV2LabOperationController {
  constructor(private readonly service: ConsumerV2LabService) {}

  @Post('lookup')
  @ConsumerV2RequiredScope('fiscal-v2:operations:read')
  async lookup(
    @Req() req: { consumerV2: ConsumerV2Principal },
    @Body() body: LookupConsumerOperationV2Dto,
    @Headers('x-correlation-id') requestedCorrelationId: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    const id = correlationId(requestedCorrelationId);
    const result = await this.service.lookupOperation({
      principal: req.consumerV2,
      operation: body.operation,
      idempotencyKey: body.idempotencyKey,
      requestHashVersion: body.requestHashVersion,
      requestHash: body.requestHash,
      correlationId: id,
    });
    if (result.status === 404 || result.status === 409) {
      throw new HttpException({ code: result.code }, result.status);
    }
    response.status(result.status);
    if (result.retryAfterSeconds)
      response.setHeader('Retry-After', String(result.retryAfterSeconds));
    return {
      operation: body.operation,
      state: result.state,
      fiscalDocumentId: result.fiscalDocumentId,
      correlationId: id,
      ...(result.retryAfterSeconds ? { retryAfterSeconds: result.retryAfterSeconds } : {}),
    };
  }
}
