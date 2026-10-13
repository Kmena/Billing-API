import { ConfigService } from '@nestjs/config';
import {
  EnsureHaciendaResponseDeliveryService,
  StartupRecoveryWindow,
} from '../ensure-hacienda-response-delivery.service';

const WINDOW: StartupRecoveryWindow = {
  startAt: new Date('2026-10-01T00:00:00.000Z'),
  endAt: new Date('2026-10-02T00:00:00.000Z'),
};

function submission(id: string, deliveries: Array<{ id: string }> = []) {
  return {
    id,
    status: 'ACCEPTED',
    fiscalDocument: {
      id: `document-${id}`,
      tenantId: 'tenant-1',
      companyId: 'company-1',
      type: 'INVOICE',
      receiverSnapshot: { email: 'legacy@example.com' },
      documentDeliveries: deliveries,
    },
  };
}

function setup(
  config: Record<string, boolean | string | undefined> = {},
  receiverSnapshot: unknown = { email: 'legacy@example.com' },
) {
  const prisma = {
    fiscalSubmission: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ responseStorageKey: 'response.xml', responseSha256: 'a'.repeat(64) }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    fiscalDocument: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'doc-1',
        tenantId: 'tenant-1',
        companyId: 'company-1',
        type: 'INVOICE',
        receiverSnapshot,
      }),
    },
    documentDelivery: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(undefined),
      update: jest.fn(),
    },
  };
  const queue = { publish: jest.fn().mockResolvedValue(undefined) };
  const configService = { get: jest.fn((key: string) => config[key]) };
  return {
    prisma,
    queue,
    configService,
    service: new EnsureHaciendaResponseDeliveryService(
      prisma as never,
      queue as never,
      configService as unknown as ConfigService,
    ),
  };
}

describe('EnsureHaciendaResponseDeliveryService startup recovery safety', () => {
  it('does not scan when startup recovery is disabled or missing', async () => {
    const ctx = setup();
    await ctx.service.onModuleInit();
    expect(ctx.prisma.fiscalSubmission.findMany).not.toHaveBeenCalled();
  });

  it('fails closed when enabled without a complete bounded window', async () => {
    const ctx = setup({ FISCAL_DELIVERY_STARTUP_RECOVERY_ENABLED: true });
    await expect(ctx.service.onModuleInit()).rejects.toThrow('explicit bounded recovery window');
    expect(ctx.prisma.fiscalSubmission.findMany).not.toHaveBeenCalled();
  });

  it('schedules only a valid bounded startup scan with deterministic ordering', async () => {
    const ctx = setup({
      FISCAL_DELIVERY_STARTUP_RECOVERY_ENABLED: true,
      FISCAL_DELIVERY_STARTUP_RECOVERY_START_AT: WINDOW.startAt.toISOString(),
      FISCAL_DELIVERY_STARTUP_RECOVERY_END_AT: WINDOW.endAt.toISOString(),
    });
    const scheduled: Array<() => unknown> = [];
    const spy = jest.spyOn(global, 'setImmediate').mockImplementation((callback) => {
      scheduled.push(callback as unknown as () => unknown);
      return {} as NodeJS.Immediate;
    });

    await ctx.service.onModuleInit();
    expect(scheduled).toHaveLength(1);
    await scheduled[0]();

    expect(ctx.prisma.fiscalSubmission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { id: 'asc' },
        take: 100,
        where: expect.objectContaining({
          OR: [
            { status: 'ACCEPTED', acceptedAt: { gte: WINDOW.startAt, lt: WINDOW.endAt } },
            { status: 'REJECTED', rejectedAt: { gte: WINDOW.startAt, lt: WINDOW.endAt } },
          ],
        }),
      }),
    );
    spy.mockRestore();
  });

  it('skips an INV-4-shaped document that already has a Hacienda-response delivery', async () => {
    const ctx = setup();
    ctx.prisma.fiscalSubmission.findMany.mockResolvedValue([
      submission('inv4', [{ id: 'existing-delivered-hacienda-response' }]),
    ]);

    await ctx.service.recoverMissedDeliveries(WINDOW);

    expect(ctx.prisma.documentDelivery.create).not.toHaveBeenCalled();
    expect(ctx.queue.publish).not.toHaveBeenCalled();
  });

  it('keeps normal terminal-result delivery independent from the startup switch', async () => {
    const ctx = setup({ FISCAL_DELIVERY_STARTUP_RECOVERY_ENABLED: false });
    await ctx.service.ensure({
      tenantId: 'tenant-1',
      companyId: 'company-1',
      fiscalDocumentId: 'doc-1',
      responseKind: 'ACCEPTED',
    });

    expect(ctx.prisma.documentDelivery.create).toHaveBeenCalled();
    expect(ctx.queue.publish).toHaveBeenCalled();
  });

  it('uses deterministic cursor pagination beyond the previous 100-row cap', async () => {
    const ctx = setup();
    const firstPage = Array.from({ length: 100 }, (_, index) =>
      submission(`submission-${String(index).padStart(3, '0')}`),
    );
    ctx.prisma.fiscalSubmission.findMany
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([submission('submission-100')]);

    await ctx.service.recoverMissedDeliveries(WINDOW);

    expect(ctx.prisma.fiscalSubmission.findMany).toHaveBeenCalledTimes(2);
    expect(ctx.prisma.fiscalSubmission.findMany.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        orderBy: { id: 'asc' },
        cursor: { id: 'submission-099' },
        skip: 1,
        take: 100,
      }),
    );
    expect(ctx.prisma.documentDelivery.create).toHaveBeenCalledTimes(101);
    expect(ctx.queue.publish).toHaveBeenCalledTimes(101);
  });
});

describe('EnsureHaciendaResponseDeliveryService recipient compatibility', () => {
  it('uses legacy email for Hacienda response delivery', async () => {
    const ctx = setup({}, { email: 'legacy@example.com' });
    await ctx.service.ensure({
      tenantId: 'tenant-1',
      companyId: 'company-1',
      fiscalDocumentId: 'doc-1',
      responseKind: 'ACCEPTED',
    });
    expect(ctx.prisma.documentDelivery.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ recipient: 'legacy@example.com' }),
      }),
    );
  });

  it('fails closed for conflicting recipient fields without creating a delivery', async () => {
    const ctx = setup(
      {},
      { correoElectronico: 'canonical@example.com', email: 'legacy@example.com' },
    );
    await ctx.service.ensure({
      tenantId: 'tenant-1',
      companyId: 'company-1',
      fiscalDocumentId: 'doc-1',
      responseKind: 'ACCEPTED',
    });
    expect(ctx.prisma.documentDelivery.create).not.toHaveBeenCalled();
    expect(ctx.queue.publish).not.toHaveBeenCalled();
  });
});
