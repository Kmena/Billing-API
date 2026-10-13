import { ConfigService } from '@nestjs/config';
import { DurableDeliveryRecoveryService } from '../durable-delivery-recovery.service';

describe('DurableDeliveryRecoveryService', () => {
  const now = new Date('2026-10-11T12:00:00.000Z');

  function makeContext(overrides: Record<string, unknown> = {}) {
    const prisma = {
      documentDelivery: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([{ id: 'delivery-a' }, { id: 'delivery-b' }]),
      },
    };
    const queue = { publish: jest.fn().mockResolvedValue(undefined) };
    const values: Record<string, unknown> = {
      FISCAL_DELIVERY_RECOVERY_START_AT: '2026-10-11T00:00:00.000Z',
      FISCAL_DELIVERY_RECOVERY_MAX_AGE_HOURS: 72,
      FISCAL_DELIVERY_RECOVERY_MAX_BATCH: 100,
      FISCAL_DELIVERY_RECOVERY_LEASE_SECONDS: 300,
      ...overrides,
    };
    const config = { get: jest.fn((key: string) => values[key]) } as unknown as ConfigService;
    return {
      prisma,
      queue,
      service: new DurableDeliveryRecoveryService(prisma as never, queue as never, config),
    };
  }

  it('recovers due work and republishes durable queued rows with singleton keys', async () => {
    const { prisma, queue, service } = makeContext();

    const result = await service.recoverOnce(now);

    expect(prisma.documentDelivery.updateMany).toHaveBeenCalledTimes(2);
    expect(prisma.documentDelivery.updateMany.mock.calls[0][0].data).toMatchObject({
      status: 'MANUAL_REVIEW_REQUIRED',
      lastErrorCode: 'UNKNOWN_EXTERNAL_OUTCOME',
    });
    expect(prisma.documentDelivery.updateMany.mock.calls[1][0].data).toMatchObject({
      status: 'QUEUED',
      nextAttemptAt: null,
    });
    expect(queue.publish).toHaveBeenCalledTimes(2);
    expect(queue.publish).toHaveBeenCalledWith(
      'fiscal-document-delivery',
      { deliveryId: 'delivery-a' },
      expect.objectContaining({ singletonKey: 'fiscal-delivery:delivery-a' }),
    );
    expect(result).toEqual({
      discovered: 2,
      republished: 2,
      dueRetriesQueued: 0,
      staleClaimsEscalated: 0,
      publicationFailures: 0,
    });
  });

  it('keeps queued work durable when the queue is unavailable', async () => {
    const { prisma, queue, service } = makeContext();
    queue.publish.mockRejectedValueOnce(new Error('queue unavailable'));

    const result = await service.recoverOnce(now);

    expect(result.republished).toBe(1);
    expect(result.publicationFailures).toBe(1);
    expect(prisma.documentDelivery.updateMany).toHaveBeenCalledTimes(2);
  });

  it('requires a watermark when recovery is explicitly enabled', async () => {
    const { service } = makeContext({
      FISCAL_DELIVERY_RECOVERY_ENABLED: true,
      FISCAL_DELIVERY_RECOVERY_START_AT: undefined,
    });

    await expect(service.onModuleInit()).rejects.toThrow('FISCAL_DELIVERY_RECOVERY_START_AT');
  });
});
