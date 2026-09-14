import { Controller, Param, Post, Request, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiKeyAuthGuard, ApiKeyRequest } from '../../../../api/guards/api-key-auth.guard';
import { ScopeGuard } from '../../../../api/guards/scope.guard';
import { PrepareFiscalXmlService } from '../../application/fiscal-xml/prepare-fiscal-xml.service';
import { PrepareFiscalXmlResponseDto } from './dtos/prepare-fiscal-xml.response.dto';

@ApiTags('Fiscal XML')
@SkipThrottle()
@UseGuards(ApiKeyAuthGuard, ScopeGuard)
@ApiHeader({ name: 'X-API-Key', required: true })
@Controller('fiscal-documents/:id')
export class FiscalXmlController {
  constructor(private readonly prepareFiscalXmlService: PrepareFiscalXmlService) {}

  @Post('prepare-xml')
  @ApiOkResponse({ type: PrepareFiscalXmlResponseDto })
  async prepareXml(
    @Request() request: ApiKeyRequest,
    @Param('id') id: string,
  ): Promise<PrepareFiscalXmlResponseDto> {
    return this.prepareFiscalXmlService.execute({
      tenantId: request.user.tenantId,
      documentId: id,
      apiKeyId: request.apiKey.id,
      scopes: request.apiKey.scopes,
      actor: `apiKey:${request.apiKey.keyPrefix}`,
    });
  }
}
