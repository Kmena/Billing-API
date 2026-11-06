import { Controller, Get, Param, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import {
  ConsumerV2Guard,
  ConsumerV2Principal,
} from '../fiscal-consumers/infrastructure/http/consumer-v2.guard';
import { ConsumerV2RequiredScope } from '../fiscal-consumers/infrastructure/http/consumer-v2-scope.decorator';
import { Spec10HistoricalArchiveService } from './spec10-historical-archive.service';

@UseGuards(ConsumerV2Guard)
@Controller(
  'api/v2/lab/companies/:companyId/fiscal-documents/:environment/historical/:sourceId/:documentId',
)
export class Spec10HistoricalArchiveController {
  constructor(private readonly archive: Spec10HistoricalArchiveService) {}

  @Get()
  @ConsumerV2RequiredScope('fiscal-v2:operations:read')
  get(
    @Req() request: { consumerV2: ConsumerV2Principal },
    @Param('sourceId') sourceId: string,
    @Param('documentId') documentId: string,
  ) {
    return this.archive.get(request.consumerV2, sourceId, documentId);
  }

  @Get('artifacts/:type')
  @ConsumerV2RequiredScope('fiscal-v2:operations:read')
  async artifact(
    @Req() request: { consumerV2: ConsumerV2Principal },
    @Param('sourceId') sourceId: string,
    @Param('documentId') documentId: string,
    @Param('type') type: 'SIGNED_XML' | 'PDF' | 'HACIENDA_RESPONSE_XML',
    @Res() response: Response,
  ) {
    const result = await this.archive.artifact(request.consumerV2, sourceId, documentId, type);
    response
      .status(200)
      .setHeader('Content-Type', result.contentType)
      .setHeader('Content-Length', String(result.bytes.length))
      .setHeader('X-Content-SHA256', result.sha256)
      .setHeader('Cache-Control', 'no-store')
      .send(result.bytes);
  }
}
