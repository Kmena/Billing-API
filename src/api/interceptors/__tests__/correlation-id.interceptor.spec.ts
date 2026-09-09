import { CorrelationIdInterceptor, CORRELATION_ID_HEADER } from '../correlation-id.interceptor';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of } from 'rxjs';

function createMockContext(headers: Record<string, string> = {}): {
  context: ExecutionContext;
  request: { headers: Record<string, string>; correlationId?: string };
  setHeaderMock: jest.Mock;
} {
  const request: { headers: Record<string, string>; correlationId?: string } = { headers };
  const setHeaderMock = jest.fn();

  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({ setHeader: setHeaderMock }),
    }),
  } as unknown as ExecutionContext;

  return { context, request, setHeaderMock };
}

function createMockCallHandler(): CallHandler {
  return {
    handle: () => of(null),
  };
}

describe('CorrelationIdInterceptor', () => {
  let interceptor: CorrelationIdInterceptor;

  beforeEach(() => {
    interceptor = new CorrelationIdInterceptor();
  });

  describe('intercept()', () => {
    it('generates a UUID when X-Correlation-ID header is not present', async () => {
      const { context, request, setHeaderMock } = createMockContext();
      const handler = createMockCallHandler();

      await new Promise<void>((resolve, reject) => {
        interceptor.intercept(context, handler).subscribe({
          complete: () => {
            try {
              expect(request.correlationId).toMatch(
                /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
              );
              expect(setHeaderMock).toHaveBeenCalledWith(
                CORRELATION_ID_HEADER,
                request.correlationId,
              );
              resolve();
            } catch (err) {
              reject(err);
            }
          },
          error: reject,
        });
      });
    });

    it('propagates existing X-Correlation-ID header', async () => {
      const existingId = 'existing-correlation-id-123';
      const { context, request, setHeaderMock } = createMockContext({
        [CORRELATION_ID_HEADER.toLowerCase()]: existingId,
      });
      const handler = createMockCallHandler();

      await new Promise<void>((resolve, reject) => {
        interceptor.intercept(context, handler).subscribe({
          complete: () => {
            try {
              expect(request.correlationId).toBe(existingId);
              expect(setHeaderMock).toHaveBeenCalledWith(CORRELATION_ID_HEADER, existingId);
              resolve();
            } catch (err) {
              reject(err);
            }
          },
          error: reject,
        });
      });
    });
  });
});
