import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { DurableDeliveryRecoveryService } from '../../../src/modules/fiscal-documents/application/delivery/durable-delivery-recovery.service';
import { DeliveryWorkerService } from '../../../src/modules/fiscal-documents/application/delivery/delivery-worker.service';
import { createGuardedTestPrisma } from '../../helpers/guarded-test-prisma';
import {
  assertOwnedTestTenants,
  registerOwnedTestTenant,
  releaseOwnedTestTenants,
} from '../../helpers/test-database-ownership';

type GuardedPrisma = Awaited<ReturnType<typeof createGuardedTestPrisma>>['prisma'];

const CLAVE = '50601012500310112345600100001010000000001100000001';

async function seed(prisma: GuardedPrisma) {
  const tenantId = randomUUID();
  const companyId = randomUUID();
  const pointId = randomUUID();
  const documentId = randomUUID();
  await registerOwnedTestTenant(prisma, tenantId);
  await prisma.tenant.create({
    data: { id: tenantId, name: 'W2 recovery', slug: `w2-${tenantId.slice(0, 8)}` },
  });
  await prisma.company.create({
    data: {
      id: companyId,
      tenantId,
      legalName: 'W2 Company',
      identificationType: 'JURIDICA',
      identificationNumber: tenantId.replace(/-/g, '').slice(0, 10),
      status: 'ACTIVE',
    },
  });
  await prisma.fiscalIssuancePoint.create({
    data: {
      id: pointId,
      tenantId,
      companyId,
      environment: 'SANDBOX',
      branchCode: '001',
      terminalCode: '00001',
      isDefault: true,
    },
  });
  await prisma.fiscalDocument.create({
    data: {
      id: documentId,
      tenantId,
      companyId,
      environment: 'SANDBOX',
      type: 'INVOICE',
      status: 'ACCEPTED',
      issuancePointId: pointId,
      branchCode: '001',
      terminalCode: '00001',
      sequenceValue: 1,
      consecutive: '00100001010000000001',
      clave: CLAVE,
      securityCode: '12345678',
      issuerSnapshot: {},
      currency: 'CRC',
      saleCondition: '01',
      paymentMethod: '01',
      lines: [],
      totals: {},
    },
  });
  return { tenantId, companyId, documentId };
}

async function cleanup(prisma: GuardedPrisma, tenantId: string) {
  await assertOwnedTestTenants(prisma, [tenantId]);
  await prisma.deliveryAttempt.deleteMany({ where: { delivery: { tenantId } } });
  await prisma.documentDelivery.deleteMany({ where: { tenantId } });
  await prisma.fiscalDocument.deleteMany({ where: { tenantId } });
  await prisma.fiscalIssuancePoint.deleteMany({ where: { tenantId } });
  await prisma.company.deleteMany({ where: { tenantId } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await releaseOwnedTestTenants(prisma, [tenantId]);
}

describe('Wave 2 durable delivery recovery — disposable PostgreSQL', () => {
  let prisma: GuardedPrisma;
  let fixture: Awaited<ReturnType<typeof seed>>;
  const now = new Date('2026-10-11T16:00:00.000Z');

  function recovery(
    queue: { publish: jest.Mock },
    enabled = true,
    startAt = '2026-10-11T00:00:00.000Z',
  ) {
    const values: Record<string, unknown> = {
      FISCAL_DELIVERY_RECOVERY_ENABLED: enabled,
      FISCAL_DELIVERY_RECOVERY_START_AT: startAt,
      FISCAL_DELIVERY_RECOVERY_MAX_AGE_HOURS: 72,
      FISCAL_DELIVERY_RECOVERY_MAX_BATCH: 100,
      FISCAL_DELIVERY_RECOVERY_LEASE_SECONDS: 300,
    };
    return new DurableDeliveryRecoveryService(
      prisma as never,
      queue as never,
      {
        get: jest.fn((key: string) => values[key]),
      } as unknown as ConfigService,
    );
  }

  async function delivery(
    input: {
      status?: 'QUEUED' | 'RETRY_PENDING' | 'SENDING' | 'DELIVERED';
      createdAt?: Date;
      nextAttemptAt?: Date | null;
      lastAttemptAt?: Date | null;
      recipient?: string;
    } = {},
  ) {
    return prisma.documentDelivery.create({
      data: {
        id: randomUUID(),
        tenantId: fixture.tenantId,
        companyId: fixture.companyId,
        fiscalDocumentId: fixture.documentId,
        kind: 'INITIAL_DOCUMENT',
        channel: 'EMAIL',
        recipient: input.recipient ?? `${randomUUID()}@example.test`,
        status: input.status ?? 'QUEUED',
        createdAt: input.createdAt ?? now,
        updatedAt: now,
        nextAttemptAt: input.nextAttemptAt,
        lastAttemptAt: input.lastAttemptAt,
      },
    });
  }

  beforeAll(async () => {
    ({ prisma } = await createGuardedTestPrisma());
    fixture = await seed(prisma);
  });
  afterEach(async () => {
    await prisma.deliveryAttempt.deleteMany({
      where: { delivery: { tenantId: fixture.tenantId } },
    });
    await prisma.documentDelivery.deleteMany({ where: { tenantId: fixture.tenantId } });
  });
  afterAll(async () => {
    await cleanup(prisma, fixture.tenantId);
    await prisma.$disconnect();
  });

  it('discovers orphaned QUEUED work after queue publication failure', async () => {
    const row = await delivery();
    const queue = { publish: jest.fn().mockResolvedValue(undefined) };
    const result = await recovery(queue).recoverOnce(now);
    expect(result).toMatchObject({ discovered: 1, republished: 1 });
    expect(queue.publish).toHaveBeenCalledWith(
      'fiscal-document-delivery',
      { deliveryId: row.id },
      expect.objectContaining({ singletonKey: `fiscal-delivery:${row.id}` }),
    );
  });

  it('preserves durable queued work when publication remains unavailable', async () => {
    const row = await delivery();
    const queue = { publish: jest.fn().mockRejectedValue(new Error('offline')) };
    await expect(recovery(queue).recoverOnce(now)).resolves.toMatchObject({
      publicationFailures: 1,
    });
    await expect(
      prisma.documentDelivery.findUniqueOrThrow({ where: { id: row.id } }),
    ).resolves.toMatchObject({ status: 'QUEUED' });
  });

  it('recovers persisted queued work through a newly constructed recovery service after restart', async () => {
    const row = await delivery();
    const offline = { publish: jest.fn().mockRejectedValue(new Error('queue offline')) };
    await expect(recovery(offline).recoverOnce(now)).resolves.toMatchObject({
      publicationFailures: 1,
    });

    const online = { publish: jest.fn().mockResolvedValue(undefined) };
    const restartedService = recovery(online);
    await expect(restartedService.recoverOnce(now)).resolves.toMatchObject({
      discovered: 1,
      republished: 1,
    });
    expect(online.publish).toHaveBeenCalledWith(
      'fiscal-document-delivery',
      { deliveryId: row.id },
      expect.objectContaining({ singletonKey: `fiscal-delivery:${row.id}` }),
    );
    await expect(
      prisma.documentDelivery.findUniqueOrThrow({ where: { id: row.id } }),
    ).resolves.toMatchObject({ status: 'QUEUED' });
  });
  it('promotes only due RETRY_PENDING work', async () => {
    const due = await delivery({
      status: 'RETRY_PENDING',
      nextAttemptAt: new Date(now.getTime() - 1),
    });
    const future = await delivery({
      status: 'RETRY_PENDING',
      nextAttemptAt: new Date(now.getTime() + 60_000),
    });
    const queue = { publish: jest.fn().mockResolvedValue(undefined) };
    await recovery(queue).recoverOnce(now);
    await expect(
      prisma.documentDelivery.findUniqueOrThrow({ where: { id: due.id } }),
    ).resolves.toMatchObject({ status: 'QUEUED' });
    await expect(
      prisma.documentDelivery.findUniqueOrThrow({ where: { id: future.id } }),
    ).resolves.toMatchObject({ status: 'RETRY_PENDING' });
  });

  it('does not replay historical or over-age rows', async () => {
    await delivery({ createdAt: new Date('2026-10-10T00:00:00.000Z') });
    await delivery({ createdAt: new Date('2026-10-01T00:00:00.000Z') });
    const queue = { publish: jest.fn().mockResolvedValue(undefined) };
    await recovery(queue, true, '2026-10-11T00:00:00.000Z').recoverOnce(now);
    expect(queue.publish).not.toHaveBeenCalled();
  });

  it('marks stale claims manual-review when SMTP outcome is uncertain', async () => {
    const row = await delivery({
      status: 'SENDING',
      lastAttemptAt: new Date(now.getTime() - 600_000),
    });
    const queue = { publish: jest.fn().mockResolvedValue(undefined) };
    await recovery(queue).recoverOnce(now);
    await expect(
      prisma.documentDelivery.findUniqueOrThrow({ where: { id: row.id } }),
    ).resolves.toMatchObject({
      status: 'MANUAL_REVIEW_REQUIRED',
      lastErrorCode: 'UNKNOWN_EXTERNAL_OUTCOME',
    });
    expect(queue.publish).not.toHaveBeenCalled();
  });

  it('never regresses DELIVERED rows, even under concurrent recovery workers', async () => {
    const row = await delivery({ status: 'DELIVERED' });
    const a = { publish: jest.fn().mockResolvedValue(undefined) };
    const b = { publish: jest.fn().mockResolvedValue(undefined) };
    await Promise.all([recovery(a).recoverOnce(now), recovery(b).recoverOnce(now)]);
    await expect(
      prisma.documentDelivery.findUniqueOrThrow({ where: { id: row.id } }),
    ).resolves.toMatchObject({ status: 'DELIVERED' });
    expect(a.publish).not.toHaveBeenCalled();
    expect(b.publish).not.toHaveBeenCalled();
  });

  it('allows only one real worker claim and ignores a stale job after DELIVERED', async () => {
    const row = await delivery();
    const actualFindUnique = prisma.documentDelivery.findUnique.bind(prisma.documentDelivery);
    const actualUpdateMany = prisma.documentDelivery.updateMany.bind(prisma.documentDelivery);
    const actualAttemptCreate = prisma.deliveryAttempt.create.bind(prisma.deliveryAttempt);
    const actualAttemptUpdate = prisma.deliveryAttempt.update.bind(prisma.deliveryAttempt);
    let readCount = 0;
    let releaseReads!: () => void;
    const bothRead = new Promise<void>((resolve) => {
      releaseReads = resolve;
    });
    const workerPrisma = {
      documentDelivery: {
        findUnique: jest.fn(async (args: Parameters<typeof actualFindUnique>[0]) => {
          const result = await actualFindUnique(args);
          readCount += 1;
          if (readCount === 2) releaseReads();
          await bothRead;
          return result;
        }),
        updateMany: jest.fn((args: Parameters<typeof actualUpdateMany>[0]) =>
          actualUpdateMany(args),
        ),
      },
      deliveryAttempt: {
        create: jest.fn((args: Parameters<typeof actualAttemptCreate>[0]) =>
          actualAttemptCreate(args),
        ),
        update: jest.fn((args: Parameters<typeof actualAttemptUpdate>[0]) =>
          actualAttemptUpdate(args),
        ),
      },
    };
    const email = {
      sendEmail: jest.fn().mockResolvedValue({
        outcome: 'DELIVERED',
        providerMessageId: 'disposable-provider-id',
      }),
    };
    const audit = { record: jest.fn() };
    const makeWorker = () => {
      const worker = new DeliveryWorkerService(
        workerPrisma as never,
        {} as never,
        email as never,
        {} as never,
        {} as never,
        {} as never,
        audit as never,
      );
      jest.spyOn(worker as never, 'buildAttachments' as never).mockResolvedValue([] as never);
      return worker;
    };
    const first = makeWorker();
    const second = makeWorker();

    await Promise.all([
      first.processDelivery({ deliveryId: row.id }),
      second.processDelivery({ deliveryId: row.id }),
    ]);
    await first.processDelivery({ deliveryId: row.id });

    expect(email.sendEmail).toHaveBeenCalledTimes(1);
    expect(await prisma.deliveryAttempt.count({ where: { deliveryId: row.id } })).toBe(1);
    await expect(
      prisma.documentDelivery.findUniqueOrThrow({ where: { id: row.id } }),
    ).resolves.toMatchObject({ status: 'DELIVERED', attemptCount: 1 });
  });
  it('does not resend when a lease expires during an external send and accepts the late confirmed outcome', async () => {
    const row = await delivery();
    const actualFindUnique = prisma.documentDelivery.findUnique.bind(prisma.documentDelivery);
    const actualUpdateMany = prisma.documentDelivery.updateMany.bind(prisma.documentDelivery);
    const actualAttemptCreate = prisma.deliveryAttempt.create.bind(prisma.deliveryAttempt);
    const actualAttemptUpdate = prisma.deliveryAttempt.update.bind(prisma.deliveryAttempt);
    const workerPrisma = {
      documentDelivery: {
        findUnique: jest.fn((args: Parameters<typeof actualFindUnique>[0]) =>
          actualFindUnique(args),
        ),
        updateMany: jest.fn((args: Parameters<typeof actualUpdateMany>[0]) =>
          actualUpdateMany(args),
        ),
      },
      deliveryAttempt: {
        create: jest.fn((args: Parameters<typeof actualAttemptCreate>[0]) =>
          actualAttemptCreate(args),
        ),
        update: jest.fn((args: Parameters<typeof actualAttemptUpdate>[0]) =>
          actualAttemptUpdate(args),
        ),
      },
    };
    let signalSendStarted!: () => void;
    const sendStarted = new Promise<void>((resolve) => {
      signalSendStarted = resolve;
    });
    let releaseSend!: () => void;
    const sendReleased = new Promise<void>((resolve) => {
      releaseSend = resolve;
    });
    const email = {
      sendEmail: jest.fn(async () => {
        signalSendStarted();
        await sendReleased;
        return {
          outcome: 'DELIVERED' as const,
          providerMessageId: 'late-confirmed-provider-id',
        };
      }),
    };
    const worker = new DeliveryWorkerService(
      workerPrisma as never,
      {} as never,
      email as never,
      {} as never,
      {} as never,
      {} as never,
      { record: jest.fn() } as never,
    );
    jest.spyOn(worker as never, 'buildAttachments' as never).mockResolvedValue([] as never);

    const inFlight = worker.processDelivery({ deliveryId: row.id });
    await sendStarted;

    const recoveryQueue = { publish: jest.fn().mockResolvedValue(undefined) };
    const leaseExpiredAt = new Date(Date.now() + 600_000);
    await expect(recovery(recoveryQueue).recoverOnce(leaseExpiredAt)).resolves.toMatchObject({
      staleClaimsEscalated: 1,
    });
    await expect(
      prisma.documentDelivery.findUniqueOrThrow({ where: { id: row.id } }),
    ).resolves.toMatchObject({
      status: 'MANUAL_REVIEW_REQUIRED',
      lastErrorCode: 'UNKNOWN_EXTERNAL_OUTCOME',
    });
    expect(recoveryQueue.publish).not.toHaveBeenCalled();

    releaseSend();
    await inFlight;

    expect(email.sendEmail).toHaveBeenCalledTimes(1);
    expect(await prisma.deliveryAttempt.count({ where: { deliveryId: row.id } })).toBe(1);
    await expect(
      prisma.documentDelivery.findUniqueOrThrow({ where: { id: row.id } }),
    ).resolves.toMatchObject({
      status: 'DELIVERED',
      attemptCount: 1,
      providerMessageId: 'late-confirmed-provider-id',
    });

    await recovery(recoveryQueue).recoverOnce(new Date(leaseExpiredAt.getTime() + 600_000));
    expect(recoveryQueue.publish).not.toHaveBeenCalled();
    expect(email.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('is disabled by default and requires a watermark when enabled', async () => {
    const queue = { publish: jest.fn().mockResolvedValue(undefined) };
    await expect(recovery(queue, false).onModuleInit()).resolves.toBeUndefined();
    expect(queue.publish).not.toHaveBeenCalled();
    await expect(recovery(queue, true, '' as never).onModuleInit()).rejects.toThrow(
      'FISCAL_DELIVERY_RECOVERY_START_AT',
    );
  });

  it('republishes distinct delivery identities without mixing job payloads', async () => {
    const own = await delivery();
    const foreign = await prisma.documentDelivery.create({
      data: {
        id: randomUUID(),
        tenantId: fixture.tenantId,
        companyId: fixture.companyId,
        fiscalDocumentId: fixture.documentId,
        kind: 'HACIENDA_RESPONSE',
        channel: 'EMAIL',
        recipient: 'foreign@example.test',
        status: 'QUEUED',
        createdAt: now,
        updatedAt: now,
      },
    });
    const queue = { publish: jest.fn().mockResolvedValue(undefined) };
    await recovery(queue).recoverOnce(now);
    expect(queue.publish.mock.calls.map((c) => c[1].deliveryId)).toEqual(
      expect.arrayContaining([own.id, foreign.id]),
    );
  });
});
