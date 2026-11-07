import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Response } from 'express';
import {
  ConsumerV2Guard,
  ConsumerV2Principal,
} from '../fiscal-consumers/infrastructure/http/consumer-v2.guard';
import { ConsumerV2RequiredScope } from '../fiscal-consumers/infrastructure/http/consumer-v2-scope.decorator';
import { W2AStructuralValidationError } from './w2-a-structural-intent';
import { W2BLabProjectionError } from './w2-b-lab-projection';
import { W2B2LabInvoiceService } from './w2-b2-lab-invoice.service';
import { W2B2LabSubmissionService } from './w2-b2-lab-submission.service';
import { W2B2LabAcceptedPackageService } from './w2-b2-lab-accepted-package.service';
import {
  Spec10InvoiceDocumentsService,
  Spec10ArtifactType,
} from './spec10-invoice-documents.service';

/** Registered only by W2B2FiscalLabModule in disposable test applications. */
@UseGuards(ConsumerV2Guard)
@Controller('api/v2/lab/companies/:companyId/fiscal-documents/:environment/invoices')
export class W2B2LabInvoiceController {
  constructor(
    private readonly invoices: W2B2LabInvoiceService,
    private readonly submissions: W2B2LabSubmissionService,
    private readonly acceptedPackages: W2B2LabAcceptedPackageService,
    private readonly documents: Spec10InvoiceDocumentsService,
  ) {}

  @Post()
  @ConsumerV2RequiredScope('fiscal-v2:invoices:create')
  async create(
    @Req() request: { consumerV2: ConsumerV2Principal },
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') requestedCorrelationId: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!idempotencyKey) throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
    if (
      requestedCorrelationId &&
      !/^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(
        requestedCorrelationId,
      )
    ) {
      throw new BadRequestException({ code: 'CORRELATION_ID_INVALID' });
    }
    try {
      const result = await this.invoices.create({
        principal: request.consumerV2,
        idempotencyKey,
        intent: body,
        correlationId: requestedCorrelationId ?? randomUUID(),
      });
      response.status(result.httpStatus).setHeader('Cache-Control', 'no-store');
      if (result.httpStatus === 202) response.setHeader('Retry-After', '3');
      const { httpStatus: _httpStatus, ...safe } = result;
      return safe;
    } catch (error) {
      if (error instanceof W2AStructuralValidationError) {
        throw new BadRequestException({ code: error.code, details: { path: error.path } });
      }
      if (error instanceof W2BLabProjectionError) {
        throw new HttpException(
          { code: error.code, details: { path: error.path } },
          error.code === 'W2B_TAX_POLICY_PENDING' ? 422 : 400,
        );
      }
      throw error;
    }
  }

  @Get(':documentId')
  @ConsumerV2RequiredScope('fiscal-v2:operations:read')
  getDocument(
    @Req() request: { consumerV2: ConsumerV2Principal },
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    return this.invoices.getDocument(request.consumerV2, documentId, ['INVOICE']);
  }

  @Get(':documentId/fiscal-view')
  @ConsumerV2RequiredScope('fiscal-v2:operations:read')
  fiscalView(
    @Req() request: { consumerV2: ConsumerV2Principal },
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    return this.documents.view(request.consumerV2, documentId);
  }

  @Get(':documentId/artifacts/:type')
  @ConsumerV2RequiredScope('fiscal-v2:operations:read')
  async fiscalArtifact(
    @Req() request: { consumerV2: ConsumerV2Principal },
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Param('type') type: string,
    @Res() response: Response,
  ) {
    if (!['PDF', 'SIGNED_XML', 'HACIENDA_RESPONSE_XML'].includes(type))
      throw new BadRequestException({ code: 'FISCAL_ARTIFACT_TYPE_INVALID' });
    const artifact = await this.documents.artifact(
      request.consumerV2,
      documentId,
      type as Spec10ArtifactType,
    );
    this.sendArtifact(response, artifact);
  }

  @Get(':documentId/package')
  @ConsumerV2RequiredScope('fiscal-v2:operations:read')
  async fiscalPackage(
    @Req() request: { consumerV2: ConsumerV2Principal },
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Res() response: Response,
  ) {
    this.sendArtifact(response, await this.documents.package(request.consumerV2, documentId));
  }

  private sendArtifact(
    response: Response,
    artifact: { bytes: Buffer; contentType: string; sha256: string; filename: string },
  ) {
    const safeName = artifact.filename.replace(/[^A-Za-z0-9_.-]/g, '_');
    response
      .status(200)
      .setHeader('Cache-Control', 'no-store')
      .setHeader('Content-Type', artifact.contentType)
      .setHeader('Content-Length', String(artifact.bytes.length))
      .setHeader('Content-Disposition', `attachment; filename="${safeName}"`)
      .setHeader('X-Content-SHA256', artifact.sha256)
      .send(artifact.bytes);
  }

  @Get(':documentId/signed-xml')
  @ConsumerV2RequiredScope('fiscal-v2:operations:read')
  async signedXml(
    @Req() request: { consumerV2: ConsumerV2Principal },
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Res() response: Response,
  ) {
    const artifact = await this.invoices.signedInvoiceXml(request.consumerV2, documentId);
    response
      .status(200)
      .setHeader('Cache-Control', 'no-store')
      .setHeader('Content-Type', artifact.contentType)
      .setHeader('X-Content-SHA256', artifact.sha256)
      .send(artifact.bytes);
  }

  @Post(':documentId/submit')
  @ConsumerV2RequiredScope('fiscal-v2:invoices:submit')
  async submit(
    @Req() request: { consumerV2: ConsumerV2Principal },
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.submissions.submit(request.consumerV2, documentId, randomUUID());
    response.status(202).setHeader('Cache-Control', 'no-store');
    return result;
  }

  @Get(':documentId/submission')
  @ConsumerV2RequiredScope('fiscal-v2:operations:read')
  async submission(
    @Req() request: { consumerV2: ConsumerV2Principal },
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.submissions.status(request.consumerV2, documentId);
  }

  @Post(':documentId/accepted-package')
  @ConsumerV2RequiredScope('fiscal-v2:deliveries:request')
  async requestAcceptedPackage(
    @Req() request: { consumerV2: ConsumerV2Principal },
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.acceptedPackages.request(request.consumerV2, documentId);
    response
      .status(result.status === 'DELIVERED' ? 200 : 202)
      .setHeader('Cache-Control', 'no-store');
    return result;
  }
}
