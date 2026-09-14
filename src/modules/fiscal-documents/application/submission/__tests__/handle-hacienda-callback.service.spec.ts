import { BadRequestException } from '@nestjs/common';
import { HandleHaciendaCallbackService } from '../handle-hacienda-callback.service';

const clave = '50601012500310112345600100001010000000001100000001';

function makeService(status = 'PROCESSING') {
  const prisma = {
    fiscalSubmission: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: 'submission-id', clave, status, lastProviderStatus: null }),
      update: jest.fn().mockResolvedValue(undefined),
    },
  };
  const queue = { publish: jest.fn().mockResolvedValue(undefined) };
  return {
    service: new HandleHaciendaCallbackService(prisma as never, queue as never),
    prisma,
    queue,
  };
}

describe('HandleHaciendaCallbackService', () => {
  it('treats callback as signal-only and enqueues authenticated reconciliation', async () => {
    const { service, prisma, queue } = makeService();

    await expect(service.execute({ clave, 'ind-estado': 'aceptado' })).resolves.toEqual({
      accepted: true,
      enqueued: true,
    });

    expect(prisma.fiscalSubmission.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastProviderStatus: 'aceptado' }),
      }),
    );
    expect(queue.publish).toHaveBeenCalledWith(
      'fiscal-documents.reconcile-hacienda-status',
      { submissionId: 'submission-id' },
      expect.any(Object),
    );
  });

  it('is duplicate safe for terminal submissions and does not forge terminal state', async () => {
    const { service, prisma, queue } = makeService('ACCEPTED');

    await expect(service.execute({ clave, 'ind-estado': 'rechazado' })).resolves.toEqual({
      accepted: true,
      enqueued: false,
    });

    expect(prisma.fiscalSubmission.update).not.toHaveBeenCalled();
    expect(queue.publish).not.toHaveBeenCalled();
  });

  it('validates callback Clave format', async () => {
    const { service } = makeService();
    await expect(service.execute({ clave: 'bad' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
