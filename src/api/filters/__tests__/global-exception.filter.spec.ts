import { ArgumentsHost } from '@nestjs/common';
import { GlobalExceptionFilter } from '../global-exception.filter';

describe('GlobalExceptionFilter', () => {
  it('sanitizes unexpected errors in production using injected environment', () => {
    const response = createResponse();
    const host = createHost(response);
    const filter = new GlobalExceptionFilter('production');

    filter.catch(new Error('database password leaked'), host);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'An unexpected error occurred.',
          correlationId: 'corr-1',
        }),
      }),
    );
  });

  it('preserves unexpected error messages outside production using injected environment', () => {
    const response = createResponse();
    const host = createHost(response);
    const filter = new GlobalExceptionFilter('test');

    filter.catch(new Error('diagnostic message'), host);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'diagnostic message',
          correlationId: 'corr-1',
        }),
      }),
    );
  });
});

function createResponse(): { status: jest.Mock; json: jest.Mock } {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

function createHost(response: { status: jest.Mock; json: jest.Mock }): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({
        correlationId: 'corr-1',
        url: '/api/v1/test',
        method: 'GET',
      }),
    }),
  } as unknown as ArgumentsHost;
}
