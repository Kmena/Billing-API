import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { ApiKeyAuthGuard, ApiKeyRequest } from '../../../../api/guards/api-key-auth.guard';
import { ScopeGuard } from '../../../../api/guards/scope.guard';
import { Scopes } from '../../../../api/decorators/scopes.decorator';
import { FiscalDocumentService } from '../../application/fiscal-document.service';
import { PrepareFiscalXmlService } from '../../application/fiscal-xml/prepare-fiscal-xml.service';
import { HaciendaEnvironment } from '../../domain/fiscal.constants';
import { CreateCorrectiveNoteLabDto } from './dtos/corrective-note-lab.dto';

const sandboxOnly = { SANDBOX: 'SANDBOX' } as const;
type NoteType = 'CREDIT_NOTE' | 'DEBIT_NOTE';

/** Deliberately reachable only when CorrectiveNotesLabModule is explicitly bootstrapped. */
@ApiTags('Corrective Notes Laboratory')
@ApiHeader({ name: 'X-API-Key', required: true })
@UseGuards(ApiKeyAuthGuard, ScopeGuard)
@Controller('lab/companies/:companyId/fiscal-documents/:environment')
export class CorrectiveNotesLabController {
  constructor(
    private readonly documents: FiscalDocumentService,
    private readonly prepare: PrepareFiscalXmlService,
  ) {}

  @Post('credit-notes')
  @Scopes('credit-notes:write')
  credit(
    @Request() request: ApiKeyRequest,
    @Param('companyId') companyId: string,
    @Param('environment', new ParseEnumPipe(sandboxOnly)) environment: HaciendaEnvironment,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: CreateCorrectiveNoteLabDto,
  ) {
    if (body.lines !== undefined) {
      throw new BadRequestException({ code: 'CREDIT_NOTE_LINES_NOT_ALLOWED' });
    }
    return this.create('CREDIT_NOTE', request, companyId, environment, key, body);
  }

  @Post('debit-notes')
  @Scopes('debit-notes:write')
  debit(
    @Request() request: ApiKeyRequest,
    @Param('companyId') companyId: string,
    @Param('environment', new ParseEnumPipe(sandboxOnly)) environment: HaciendaEnvironment,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: CreateCorrectiveNoteLabDto,
  ) {
    if (!body.lines?.length) throw new BadRequestException({ code: 'DEBIT_NOTE_LINES_REQUIRED' });
    return this.create('DEBIT_NOTE', request, companyId, environment, key, body);
  }

  @Get('credit-notes/by-key/:key')
  @Scopes('credit-notes:read')
  creditByKey(
    @Request() request: ApiKeyRequest,
    @Param('companyId') companyId: string,
    @Param('environment', new ParseEnumPipe(sandboxOnly)) environment: HaciendaEnvironment,
    @Param('key') key: string,
  ) {
    return this.lookup('CREDIT_NOTE', request, companyId, environment, { idempotencyKey: key });
  }

  @Get('debit-notes/by-key/:key')
  @Scopes('debit-notes:read')
  debitByKey(
    @Request() request: ApiKeyRequest,
    @Param('companyId') companyId: string,
    @Param('environment', new ParseEnumPipe(sandboxOnly)) environment: HaciendaEnvironment,
    @Param('key') key: string,
  ) {
    return this.lookup('DEBIT_NOTE', request, companyId, environment, { idempotencyKey: key });
  }

  @Get('credit-notes/:id')
  @Scopes('credit-notes:read')
  creditById(
    @Request() request: ApiKeyRequest,
    @Param('companyId') companyId: string,
    @Param('environment', new ParseEnumPipe(sandboxOnly)) environment: HaciendaEnvironment,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.lookup('CREDIT_NOTE', request, companyId, environment, { documentId: id });
  }

  @Get('debit-notes/:id')
  @Scopes('debit-notes:read')
  debitById(
    @Request() request: ApiKeyRequest,
    @Param('companyId') companyId: string,
    @Param('environment', new ParseEnumPipe(sandboxOnly)) environment: HaciendaEnvironment,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.lookup('DEBIT_NOTE', request, companyId, environment, { documentId: id });
  }

  @Post('credit-notes/:id/prepare-xml')
  @Scopes('credit-notes:write')
  prepareCredit(
    @Request() request: ApiKeyRequest,
    @Param('companyId') companyId: string,
    @Param('environment', new ParseEnumPipe(sandboxOnly)) environment: HaciendaEnvironment,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.prepareNote('CREDIT_NOTE', request, companyId, environment, id);
  }

  @Post('debit-notes/:id/prepare-xml')
  @Scopes('debit-notes:write')
  prepareDebit(
    @Request() request: ApiKeyRequest,
    @Param('companyId') companyId: string,
    @Param('environment', new ParseEnumPipe(sandboxOnly)) environment: HaciendaEnvironment,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.prepareNote('DEBIT_NOTE', request, companyId, environment, id);
  }

  private create(
    type: NoteType,
    request: ApiKeyRequest,
    companyId: string,
    environment: HaciendaEnvironment,
    key: string | undefined,
    body: CreateCorrectiveNoteLabDto,
  ) {
    if (!key || key.length > 255)
      throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
    return this.documents.createCorrectiveNoteLab({
      tenantId: request.user.tenantId,
      companyId,
      environment,
      type,
      sourceDocumentId: body.sourceDocumentId,
      referenceCode: body.referenceCode,
      referenceReason: body.reason,
      lines: body.lines,
      idempotencyKey: key,
      apiKeyId: request.apiKey.id,
      actor: `apiKey:${request.apiKey.keyPrefix}`,
    });
  }

  private lookup(
    type: NoteType,
    request: ApiKeyRequest,
    companyId: string,
    environment: HaciendaEnvironment,
    identifier: { documentId?: string; idempotencyKey?: string },
  ) {
    return this.documents.getCorrectiveNoteLab({
      tenantId: request.user.tenantId,
      companyId,
      environment,
      type,
      apiKeyId: request.apiKey.id,
      ...identifier,
    });
  }

  private async prepareNote(
    type: NoteType,
    request: ApiKeyRequest,
    companyId: string,
    environment: HaciendaEnvironment,
    id: string,
  ) {
    await this.lookup(type, request, companyId, environment, { documentId: id });
    return this.prepare.execute({
      tenantId: request.user.tenantId,
      documentId: id,
      apiKeyId: request.apiKey.id,
      scopes: request.apiKey.scopes,
      actor: `apiKey:${request.apiKey.keyPrefix}`,
    });
  }
}
