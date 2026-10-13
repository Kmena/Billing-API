import { randomUUID } from 'crypto';
import { createServer, Server, Socket } from 'net';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { DurableDeliveryRecoveryService } from '../../src/modules/fiscal-documents/application/delivery/durable-delivery-recovery.service';
import { DeliveryWorkerService } from '../../src/modules/fiscal-documents/application/delivery/delivery-worker.service';
import { createGuardedTestPrisma } from '../helpers/guarded-test-prisma';
import {
  assertOwnedTestTenants,
  registerOwnedTestTenant,
  releaseOwnedTestTenants,
} from '../helpers/test-database-ownership';

class TcpFaultProxy {
  private server?: Server;
  private partitioned = false;
  private dropNextUpstreamChunk = false;
  private readonly sockets = new Set<Socket>();
  port = 0;

  constructor(
    private readonly upstreamHost: string,
    private readonly upstreamPort: number,
  ) {}

  async start(): Promise<void> {
    this.server = createServer((client) => {
      this.sockets.add(client);
      if (this.partitioned) {
        client.destroy();
        return;
      }
      const upstream = new Socket();
      this.sockets.add(upstream);
      const close = () => {
        client.destroy();
        upstream.destroy();
        this.sockets.delete(client);
        this.sockets.delete(upstream);
      };
      client.once('error', close);
      upstream.once('error', close);
      client.once('close', close);
      upstream.once('close', close);
      client.on('data', (chunk) => {
        if (this.partitioned) return close();
        upstream.write(chunk);
      });
      upstream.on('data', (chunk) => {
        if (this.partitioned || this.dropNextUpstreamChunk) {
          this.dropNextUpstreamChunk = false;
          close();
          return;
        }
        client.write(chunk);
      });
      upstream.connect(this.upstreamPort, this.upstreamHost);
    });
    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(0, '127.0.0.1', () => {
        this.server?.off('error', reject);
        const address = this.server?.address();
        if (!address || typeof address === 'string') throw new Error('Proxy port unavailable');
        this.port = address.port;
        resolve();
      });
    });
  }

  partition(): void {
    this.partitioned = true;
    for (const socket of [...this.sockets]) socket.destroy();
  }

  heal(): void {
    this.partitioned = false;
    this.dropNextUpstreamChunk = false;
  }

  dropNextServerResponse(): void {
    this.dropNextUpstreamChunk = true;
  }

  async stop(): Promise<void> {
    this.partition();
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }
}

function proxiedUrl(url: string, port: number): string {
  const parsed = new URL(url);
  parsed.hostname = '127.0.0.1';
  parsed.port = String(port);
  return parsed.toString();
}

describe('Wave 2 operational PostgreSQL TCP partition — disposable infrastructure', () => {
  const originalUrl = process.env.DATABASE_URL;
  const originalTestUrl = process.env.BILLING_TEST_DATABASE_URL;
  let proxy: TcpFaultProxy;
  let prisma: PrismaClient;
  let fixture: { tenantId: string; companyId: string; documentId: string };

  beforeAll(async () => {
    if (!originalUrl || !originalTestUrl) throw new Error('Disposable database URLs are required');
    const direct = new URL(originalTestUrl);
    proxy = new TcpFaultProxy(direct.hostname, Number(direct.port || 5432));
    await proxy.start();
    const proxyUrl = proxiedUrl(originalTestUrl, proxy.port);
    process.env.DATABASE_URL = proxyUrl;
    process.env.BILLING_TEST_DATABASE_URL = proxyUrl;
    ({ prisma } = await createGuardedTestPrisma());

    const tenantId = randomUUID();
    const companyId = randomUUID();
    const pointId = randomUUID();
    const documentId = randomUUID();
    await registerOwnedTestTenant(prisma, tenantId);
    await prisma.tenant.create({
      data: { id: tenantId, name: 'TCP partition fixture', slug: `tcp-${tenantId.slice(0, 8)}` },
    });
    await prisma.company.create({
      data: {
        id: companyId,
        tenantId,
        legalName: 'TCP Partition Company',
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
        clave: '50601012500310112345600100001010000000001100000001',
        securityCode: '12345678',
        issuerSnapshot: {},
        currency: 'CRC',
        saleCondition: '01',
        paymentMethod: '01',
        lines: [],
        totals: {},
      },
    });
    fixture = { tenantId, companyId, documentId };
    await prisma.$executeRawUnsafe(
      'CREATE TABLE IF NOT EXISTS wave2_tcp_probe (id text PRIMARY KEY, value text NOT NULL)',
    );
  });

  afterEach(async () => {
    proxy.heal();
    await prisma.$disconnect().catch(() => undefined);
    await prisma.$connect();
    await prisma.deliveryAttempt.deleteMany({
      where: { delivery: { tenantId: fixture.tenantId } },
    });
    await prisma.documentDelivery.deleteMany({ where: { tenantId: fixture.tenantId } });
    await prisma.$executeRawUnsafe('DELETE FROM wave2_tcp_probe');
  });

  afterAll(async () => {
    proxy.heal();
    await prisma.$connect().catch(() => undefined);
    await assertOwnedTestTenants(prisma, [fixture.tenantId]);
    await prisma.deliveryAttempt.deleteMany({
      where: { delivery: { tenantId: fixture.tenantId } },
    });
    await prisma.documentDelivery.deleteMany({ where: { tenantId: fixture.tenantId } });
    await prisma.fiscalDocument.deleteMany({ where: { tenantId: fixture.tenantId } });
    await prisma.fiscalIssuancePoint.deleteMany({ where: { tenantId: fixture.tenantId } });
    await prisma.company.deleteMany({ where: { tenantId: fixture.tenantId } });
    await prisma.tenant.deleteMany({ where: { id: fixture.tenantId } });
    await releaseOwnedTestTenants(prisma, [fixture.tenantId]);
    await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS wave2_tcp_probe');
    await prisma.$disconnect();
    await proxy.stop();
    process.env.DATABASE_URL = originalUrl;
    process.env.BILLING_TEST_DATABASE_URL = originalTestUrl;
  });

  it('rolls back a transaction whose real TCP connection is severed before commit', async () => {
    const id = randomUUID();
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          'INSERT INTO wave2_tcp_probe (id, value) VALUES ($1, $2)',
          id,
          'uncommitted',
        );
        proxy.partition();
        await tx.$queryRawUnsafe('SELECT 1');
      }),
    ).rejects.toBeDefined();

    proxy.heal();
    await prisma.$disconnect();
    await prisma.$connect();
    const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      'SELECT COUNT(*)::bigint AS count FROM wave2_tcp_probe WHERE id = $1',
      id,
    );
    expect(Number(rows[0].count)).toBe(0);
  });

  it('survives a committed write whose acknowledgement is lost and deduplicates retry', async () => {
    const id = randomUUID();
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          'INSERT INTO wave2_tcp_probe (id, value) VALUES ($1, $2)',
          id,
          'committed-with-lost-ack',
        );
        proxy.dropNextServerResponse();
      }),
    ).rejects.toBeDefined();

    proxy.heal();
    await prisma.$disconnect();
    await prisma.$connect();
    await prisma.$executeRawUnsafe(
      'INSERT INTO wave2_tcp_probe (id, value) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
      id,
      'retry',
    );
    const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      'SELECT COUNT(*)::bigint AS count FROM wave2_tcp_probe WHERE id = $1',
      id,
    );
    expect(Number(rows[0].count)).toBe(1);
  });

  it('recovers a pre-claim partition and allows only one worker send after healing', async () => {
    const delivery = await prisma.documentDelivery.create({
      data: {
        id: randomUUID(),
        tenantId: fixture.tenantId,
        companyId: fixture.companyId,
        fiscalDocumentId: fixture.documentId,
        kind: 'INITIAL_DOCUMENT',
        channel: 'EMAIL',
        recipient: 'tcp-worker@example.test',
        status: 'QUEUED',
      },
    });
    const email = {
      sendEmail: jest.fn().mockResolvedValue({
        outcome: 'DELIVERED',
        providerMessageId: 'tcp-partition-synthetic',
      }),
    };
    const makeWorker = () => {
      const worker = new DeliveryWorkerService(
        prisma as never,
        {} as never,
        email as never,
        {} as never,
        {} as never,
        {} as never,
        { record: jest.fn() } as never,
      );
      jest.spyOn(worker as never, 'buildAttachments' as never).mockResolvedValue([] as never);
      return worker;
    };

    proxy.partition();
    await expect(makeWorker().processDelivery({ deliveryId: delivery.id })).rejects.toBeDefined();
    proxy.heal();
    await prisma.$disconnect();
    await prisma.$connect();

    await Promise.all([
      makeWorker().processDelivery({ deliveryId: delivery.id }),
      makeWorker().processDelivery({ deliveryId: delivery.id }),
    ]);
    expect(email.sendEmail).toHaveBeenCalledTimes(1);
    await expect(
      prisma.documentDelivery.findUniqueOrThrow({ where: { id: delivery.id } }),
    ).resolves.toMatchObject({ status: 'DELIVERED', attemptCount: 1 });
  });

  it('recovers after a scanner outage using a new service instance', async () => {
    const delivery = await prisma.documentDelivery.create({
      data: {
        id: randomUUID(),
        tenantId: fixture.tenantId,
        companyId: fixture.companyId,
        fiscalDocumentId: fixture.documentId,
        kind: 'INITIAL_DOCUMENT',
        channel: 'EMAIL',
        recipient: 'tcp-recovery@example.test',
        status: 'QUEUED',
        createdAt: new Date(),
      },
    });
    const values: Record<string, unknown> = {
      FISCAL_DELIVERY_RECOVERY_ENABLED: true,
      FISCAL_DELIVERY_RECOVERY_START_AT: '2026-10-11T00:00:00.000Z',
      FISCAL_DELIVERY_RECOVERY_MAX_AGE_HOURS: 72,
      FISCAL_DELIVERY_RECOVERY_MAX_BATCH: 100,
      FISCAL_DELIVERY_RECOVERY_LEASE_SECONDS: 30,
    };
    const config = { get: jest.fn((key: string) => values[key]) } as unknown as ConfigService;
    const offlineQueue = { publish: jest.fn().mockResolvedValue(undefined) };
    const offline = new DurableDeliveryRecoveryService(
      prisma as never,
      offlineQueue as never,
      config,
    );

    proxy.partition();
    await expect(offline.recoverOnce(new Date())).rejects.toBeDefined();
    proxy.heal();
    await prisma.$disconnect();
    await prisma.$connect();

    const restartedQueue = { publish: jest.fn().mockResolvedValue(undefined) };
    const restarted = new DurableDeliveryRecoveryService(
      prisma as never,
      restartedQueue as never,
      config,
    );
    await expect(restarted.recoverOnce(new Date())).resolves.toMatchObject({ republished: 1 });
    expect(restartedQueue.publish).toHaveBeenCalledWith(
      'fiscal-document-delivery',
      { deliveryId: delivery.id },
      expect.objectContaining({ singletonKey: `fiscal-delivery:${delivery.id}` }),
    );
  });

  it('quarantines an expired external-send lease after database recovery', async () => {
    const delivery = await prisma.documentDelivery.create({
      data: {
        id: randomUUID(),
        tenantId: fixture.tenantId,
        companyId: fixture.companyId,
        fiscalDocumentId: fixture.documentId,
        kind: 'INITIAL_DOCUMENT',
        channel: 'EMAIL',
        recipient: 'tcp-uncertain@example.test',
        status: 'SENDING',
        createdAt: new Date(),
        lastAttemptAt: new Date(Date.now() - 120_000),
      },
    });
    const values: Record<string, unknown> = {
      FISCAL_DELIVERY_RECOVERY_ENABLED: true,
      FISCAL_DELIVERY_RECOVERY_START_AT: '2026-10-11T00:00:00.000Z',
      FISCAL_DELIVERY_RECOVERY_MAX_AGE_HOURS: 72,
      FISCAL_DELIVERY_RECOVERY_MAX_BATCH: 100,
      FISCAL_DELIVERY_RECOVERY_LEASE_SECONDS: 30,
    };
    const queue = { publish: jest.fn().mockResolvedValue(undefined) };
    const service = new DurableDeliveryRecoveryService(
      prisma as never,
      queue as never,
      { get: jest.fn((key: string) => values[key]) } as unknown as ConfigService,
    );

    proxy.partition();
    await expect(service.recoverOnce(new Date())).rejects.toBeDefined();
    proxy.heal();
    await prisma.$disconnect();
    await prisma.$connect();
    await expect(service.recoverOnce(new Date())).resolves.toMatchObject({
      staleClaimsEscalated: 1,
    });
    expect(queue.publish).not.toHaveBeenCalled();
    await expect(
      prisma.documentDelivery.findUniqueOrThrow({ where: { id: delivery.id } }),
    ).resolves.toMatchObject({
      status: 'MANUAL_REVIEW_REQUIRED',
      lastErrorCode: 'UNKNOWN_EXTERNAL_OUTCOME',
    });
  });
});
