import { ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { AuditInterceptor } from '../audit.interceptor';
import { AuditService } from '../../../modules/audit/application/audit.service';

class TaxpayerController {}
class HaciendaConnectionController {}

function getTaxpayer(): void {}
function configureConnection(): void {}

describe('AuditInterceptor', () => {
  it('records categorical actions without taxpayer identifiers from URL values', async () => {
    const auditService = createAuditService();
    const interceptor = new AuditInterceptor(auditService);
    const context = createContext({
      controller: TaxpayerController,
      handler: getTaxpayer,
      method: 'GET',
      url: '/api/v1/taxpayers/123456789',
    });

    await lastValueFrom(interceptor.intercept(context, { handle: () => of({ ok: true }) }));

    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'get-taxpayer-get-taxpayer',
        endpoint: '/api/v1/taxpayers/123456789',
      }),
    );
    expect(auditService.record.mock.calls[0][0].action).not.toContain('123456789');
  });

  it('records categorical error actions without company ids or credential-like URL data', async () => {
    const auditService = createAuditService();
    const interceptor = new AuditInterceptor(auditService);
    const companyId = '00000000-0000-0000-0000-000000000000';
    const context = createContext({
      controller: HaciendaConnectionController,
      handler: configureConnection,
      method: 'PUT',
      url: `/api/v1/companies/${companyId}/hacienda-connection/SANDBOX?username=secret-user`,
    });

    await expect(
      lastValueFrom(
        interceptor.intercept(context, {
          handle: () => throwError(() => ({ status: 400, message: 'bad request' })),
        }),
      ),
    ).rejects.toEqual({ status: 400, message: 'bad request' });

    const action = auditService.record.mock.calls[0][0].action;
    expect(action).toBe('put-hacienda-connection-configure-connection');
    expect(action).not.toContain(companyId);
    expect(action).not.toContain('secret-user');
  });
});

function createAuditService(): jest.Mocked<AuditService> {
  return {
    record: jest.fn(),
  } as unknown as jest.Mocked<AuditService>;
}

function createContext(input: {
  controller: new () => object;
  handler: () => void;
  method: string;
  url: string;
}): ExecutionContext {
  return {
    getClass: () => input.controller,
    getHandler: () => input.handler,
    switchToHttp: () => ({
      getRequest: () => ({
        method: input.method,
        url: input.url,
        ip: '127.0.0.1',
        correlationId: 'corr-1',
        headers: {},
      }),
      getResponse: () => ({ statusCode: 200 }),
    }),
  } as unknown as ExecutionContext;
}
