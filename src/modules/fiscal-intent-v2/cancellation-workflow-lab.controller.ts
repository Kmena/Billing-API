import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  ConsumerV2Guard,
  ConsumerV2Principal,
} from '../fiscal-consumers/infrastructure/http/consumer-v2.guard';
import { ConsumerV2RequiredScope } from '../fiscal-consumers/infrastructure/http/consumer-v2-scope.decorator';
import { CancellationWorkflowLabService } from './cancellation-workflow-lab.service';

function object(raw: unknown, allowed: string[]): Record<string, unknown> {
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    Object.keys(raw).some((key) => !allowed.includes(key))
  )
    throw new BadRequestException({ code: 'CANCELLATION_BODY_INVALID' });
  return raw as Record<string, unknown>;
}

function action(
  principal: ConsumerV2Principal,
  key: string | undefined,
  correlation: string | undefined,
) {
  if (!key) throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
  if (
    correlation &&
    !/^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(correlation)
  )
    throw new BadRequestException({ code: 'CORRELATION_ID_INVALID' });
  return { principal, key, correlationId: correlation ?? randomUUID() };
}

@UseGuards(ConsumerV2Guard)
@Controller('api/v2/lab/companies/:companyId/fiscal-documents/:environment/cancellations')
export class CancellationWorkflowLabController {
  constructor(private readonly workflows: CancellationWorkflowLabService) {}

  @Post()
  @Header('Cache-Control', 'no-store')
  @HttpCode(200)
  @ConsumerV2RequiredScope('fiscal-v2:credit-notes:create')
  cancel(
    @Req() request: { consumerV2: ConsumerV2Principal },
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlation: string | undefined,
  ) {
    const parsed = object(body, ['sourceDocumentId', 'reason']);
    if (
      typeof parsed.sourceDocumentId !== 'string' ||
      !/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(parsed.sourceDocumentId)
    )
      throw new BadRequestException({ code: 'CANCELLATION_SOURCE_INVALID' });
    return this.workflows.cancel(
      parsed.sourceDocumentId,
      parsed.reason,
      action(request.consumerV2, key, correlation),
    );
  }

  @Get(':workflowId')
  @Header('Cache-Control', 'no-store')
  @ConsumerV2RequiredScope('fiscal-v2:operations:read')
  status(
    @Req() request: { consumerV2: ConsumerV2Principal },
    @Param('workflowId', ParseUUIDPipe) workflowId: string,
  ) {
    return this.workflows.status(workflowId, request.consumerV2);
  }

  @Post(':workflowId/replacement-draft')
  @Header('Cache-Control', 'no-store')
  @HttpCode(200)
  @ConsumerV2RequiredScope('fiscal-v2:invoices:create')
  draft(
    @Req() request: { consumerV2: ConsumerV2Principal },
    @Param('workflowId', ParseUUIDPipe) workflowId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlation: string | undefined,
  ) {
    const parsed = object(body, ['observation']);
    return this.workflows.createDraft(
      workflowId,
      parsed.observation,
      action(request.consumerV2, key, correlation),
    );
  }

  @Post(':workflowId/replacement-confirmation')
  @Header('Cache-Control', 'no-store')
  @HttpCode(200)
  @ConsumerV2RequiredScope('fiscal-v2:invoices:create')
  confirm(
    @Req() request: { consumerV2: ConsumerV2Principal },
    @Param('workflowId', ParseUUIDPipe) workflowId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlation: string | undefined,
  ) {
    const parsed = object(body, ['intent']);
    if (!parsed.intent) throw new BadRequestException({ code: 'REPLACEMENT_INTENT_REQUIRED' });
    return this.workflows.confirmReplacement(
      workflowId,
      parsed.intent,
      action(request.consumerV2, key, correlation),
    );
  }

  @Post(':workflowId/reversal')
  @Header('Cache-Control', 'no-store')
  @HttpCode(200)
  @ConsumerV2RequiredScope('fiscal-v2:debit-notes:create')
  reverse(
    @Req() request: { consumerV2: ConsumerV2Principal },
    @Param('workflowId', ParseUUIDPipe) workflowId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlation: string | undefined,
  ) {
    object(body, []);
    return this.workflows.reverse(workflowId, action(request.consumerV2, key, correlation));
  }

  @Get(':workflowId/reversal')
  @Header('Cache-Control', 'no-store')
  @ConsumerV2RequiredScope('fiscal-v2:operations:read')
  reversal(
    @Req() request: { consumerV2: ConsumerV2Principal },
    @Param('workflowId', ParseUUIDPipe) workflowId: string,
  ) {
    return this.workflows.status(workflowId, request.consumerV2);
  }

  @Get(':workflowId/history')
  @Header('Cache-Control', 'no-store')
  @ConsumerV2RequiredScope('fiscal-v2:operations:read')
  history(
    @Req() request: { consumerV2: ConsumerV2Principal },
    @Param('workflowId', ParseUUIDPipe) workflowId: string,
  ) {
    return this.workflows.history(workflowId, request.consumerV2);
  }
}
