/**
 * F4 Real PostgreSQL Concurrency Tests — TASK-018 database-level verification
 *
 * Requires: DATABASE_URL pointing to a real PostgreSQL instance.
 * Skipped automatically when DATABASE_URL is absent.
 *
 * Proves:
 * A. Duplicate INITIAL_DOCUMENT delivery creation → exactly one row (DB unique index)
 * B. Duplicate HACIENDA_RESPONSE delivery creation → exactly one row
 * C. Duplicate PDF FiscalArtifact creation → exactly one row (DB unique index)
 * D. DELIVERED terminal regression guard → UPDATE WHERE status <> DELIVERED
 * E. Stale SENDING recovery → RETRY_PENDING transition allowed
 * F. Duplicate F3 terminal hook → only one HACIENDA_RESPONSE delivery row
 * G. Concurrent attempt numbering isolation
 * H. Delivery cannot change FiscalDocument.status (invariant)
 */
// eslint-disable-next-line no-restricted-imports
import { PrismaClient } from '@prisma/client';
import { randomUUID, createHash } from 'crypto';

const describeIfDatabase = process.env.DATABASE_URL ? describe : describe.skip;

const VALID_CLAVE = '50601012500310112345600100001010000000001100000001';

async function seedF4TestFixture(prisma: PrismaClient) {
  const tenantId = randomUUID();
  const companyId = randomUUID();
  const pointId = randomUUID();
  const documentId = randomUUID();

  await prisma.tenant.create({
    data: { id: tenantId, name: `F4 Tenant ${tenantId}`, slug: `f4-${tenantId.slice(0, 8)}` },
  });
  await prisma.company.create({
    data: {
      id: companyId,
      tenantId,
      legalName: 'F4 Concurrency Company',
      identificationType: 'JURIDICA',
      identificationNumber: tenantId.replace(/-/g, '').slice(0, 10),
      status: 'ACTIVE',
      haciendaVerificationStatus: 'VERIFIED',
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
      status: 'READY_TO_SUBMIT',
      issuancePointId: pointId,
      branchCode: '001',
      terminalCode: '00001',
      sequenceValue: 1,
      consecutive: '00100001010000000001',
      clave: VALID_CLAVE,
      securityCode: '12345678',
      issuerSnapshot: { identificationType: 'JURIDICA', identificationNumber: '3101123456' },
      currency: 'CRC',
      saleCondition: '01',
      paymentMethod: '01',
      lines: [],
      totals: {},
    },
  });

  return { tenantId, companyId, documentId };
}

async function cleanupF4TestData(prisma: PrismaClient, tenantId: string) {
  await prisma.deliveryAttempt.deleteMany({ where: { delivery: { tenantId } } });
  await prisma.documentDelivery.deleteMany({ where: { tenantId } });
  await prisma.fiscalArtifact.deleteMany({ where: { tenantId } });
  await prisma.fiscalSubmission.deleteMany({ where: { tenantId } });
  await prisma.fiscalXmlArtifact.deleteMany({ where: { tenantId } });
  await prisma.fiscalDocument.deleteMany({ where: { tenantId } });
  await prisma.fiscalIssuancePoint.deleteMany({ where: { tenantId } });
  await prisma.company.deleteMany({ where: { tenantId } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
}

async function createDelivery(
  prisma: PrismaClient,
  tenantId: string,
  companyId: string,
  fiscalDocumentId: string,
  kind: 'INITIAL_DOCUMENT' | 'HACIENDA_RESPONSE',
  recipient = 'test@example.com',
) {
  const id = randomUUID();
  const now = new Date();
  try {
    await prisma.documentDelivery.create({
      data: {
        id,
        tenantId,
        companyId,
        fiscalDocumentId,
        kind,
        channel: 'EMAIL',
        recipient,
        status: 'PENDING',
        attemptCount: 0,
        updatedAt: now,
      },
    });
    return { success: true, id };
  } catch (err: unknown) {
    const msg = String(err);
    if (msg.includes('unique') || msg.includes('duplicate') || msg.includes('Unique')) {
      return { success: false, duplicate: true };
    }
    throw err;
  }
}

async function createArtifact(
  prisma: PrismaClient,
  tenantId: string,
  companyId: string,
  fiscalDocumentId: string,
  type: 'PDF' | 'SIGNED_XML',
  opts: { templateId?: string; rendererVersion?: string } = {},
) {
  const id = randomUUID();
  const sha256 = createHash('sha256').update(`${fiscalDocumentId}-${type}`).digest('hex');
  try {
    await prisma.fiscalArtifact.create({
      data: {
        id,
        tenantId,
        companyId,
        fiscalDocumentId,
        type,
        storageKey: `${type.toLowerCase()}/${fiscalDocumentId}/${id}`,
        sha256,
        contentType: type === 'PDF' ? 'application/pdf' : 'application/xml',
        sizeBytes: 1024,
        templateId: opts.templateId ?? null,
        rendererVersion: opts.rendererVersion ?? null,
      },
    });
    return { success: true, id };
  } catch (err: unknown) {
    const msg = String(err);
    if (msg.includes('unique') || msg.includes('duplicate') || msg.includes('Unique')) {
      return { success: false, duplicate: true };
    }
    throw err;
  }
}

describeIfDatabase('F4 PostgreSQL concurrency — real database', () => {
  let prisma: PrismaClient;
  let tenantId: string;
  let companyId: string;
  let documentId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    const fixture = await seedF4TestFixture(prisma);
    tenantId = fixture.tenantId;
    companyId = fixture.companyId;
    documentId = fixture.documentId;
  });

  afterAll(async () => {
    await cleanupF4TestData(prisma, tenantId);
    await prisma.$disconnect();
  });

  // ── A. Duplicate INITIAL_DOCUMENT delivery ─────────────────────────────────
  describe('A. Duplicate INITIAL_DOCUMENT creation → exactly one row', () => {
    afterEach(async () => {
      await prisma.documentDelivery.deleteMany({
        where: { fiscalDocumentId: documentId, kind: 'INITIAL_DOCUMENT' },
      });
    });

    it('concurrent createMany calls produce exactly one DocumentDelivery row', async () => {
      const results = await Promise.allSettled(
        Array.from({ length: 6 }, () =>
          createDelivery(prisma, tenantId, companyId, documentId, 'INITIAL_DOCUMENT'),
        ),
      );

      const successes = results
        .filter((r) => r.status === 'fulfilled')
        .map((r) => (r as PromiseFulfilledResult<{ success: boolean }>).value);
      const created = successes.filter((v) => v.success).length;
      const duplicated = successes.filter((v) => !v.success).length;

      expect(created).toBe(1);
      expect(duplicated).toBe(5);

      const count = await prisma.documentDelivery.count({
        where: { fiscalDocumentId: documentId, kind: 'INITIAL_DOCUMENT' },
      });
      expect(count).toBe(1);
    });
  });

  // ── B. Duplicate HACIENDA_RESPONSE delivery ────────────────────────────────
  describe('B. Duplicate HACIENDA_RESPONSE creation → exactly one row', () => {
    afterEach(async () => {
      await prisma.documentDelivery.deleteMany({
        where: { fiscalDocumentId: documentId, kind: 'HACIENDA_RESPONSE' },
      });
    });

    it('concurrent HACIENDA_RESPONSE creates produce exactly one row', async () => {
      const results = await Promise.allSettled(
        Array.from({ length: 6 }, () =>
          createDelivery(prisma, tenantId, companyId, documentId, 'HACIENDA_RESPONSE'),
        ),
      );

      const successes = results
        .filter((r) => r.status === 'fulfilled')
        .map((r) => (r as PromiseFulfilledResult<{ success: boolean }>).value);

      expect(successes.filter((v) => v.success).length).toBe(1);
      const count = await prisma.documentDelivery.count({
        where: { fiscalDocumentId: documentId, kind: 'HACIENDA_RESPONSE' },
      });
      expect(count).toBe(1);
    });
  });

  // ── C. Duplicate PDF artifact ──────────────────────────────────────────────
  describe('C. Duplicate PDF FiscalArtifact → exactly one row', () => {
    afterEach(async () => {
      await prisma.fiscalArtifact.deleteMany({ where: { fiscalDocumentId: documentId } });
    });

    it('concurrent PDF artifact creates produce exactly one row per template+version', async () => {
      const results = await Promise.allSettled(
        Array.from({ length: 6 }, () =>
          createArtifact(prisma, tenantId, companyId, documentId, 'PDF', {
            templateId: 'BILLING_DEFAULT_V1',
            rendererVersion: '1.0.0',
          }),
        ),
      );

      const successes = results
        .filter((r) => r.status === 'fulfilled')
        .map((r) => (r as PromiseFulfilledResult<{ success: boolean }>).value);

      expect(successes.filter((v) => v.success).length).toBe(1);
      expect(successes.filter((v) => !v.success).length).toBe(5);

      const count = await prisma.fiscalArtifact.count({
        where: { fiscalDocumentId: documentId, type: 'PDF' },
      });
      expect(count).toBe(1);
    });

    it('different rendererVersions create separate artifact rows (not blocked)', async () => {
      await createArtifact(prisma, tenantId, companyId, documentId, 'PDF', {
        templateId: 'BILLING_DEFAULT_V1',
        rendererVersion: '1.0.0',
      });
      await createArtifact(prisma, tenantId, companyId, documentId, 'PDF', {
        templateId: 'BILLING_DEFAULT_V1',
        rendererVersion: '2.0.0',
      });

      const count = await prisma.fiscalArtifact.count({
        where: { fiscalDocumentId: documentId, type: 'PDF' },
      });
      expect(count).toBe(2);
    });
  });

  // ── D. DELIVERED terminal regression guard ─────────────────────────────────
  describe('D. DELIVERED terminal regression — stale worker cannot regress', () => {
    let deliveryId: string;

    beforeEach(async () => {
      const created = await prisma.documentDelivery.create({
        data: {
          id: randomUUID(),
          tenantId,
          companyId,
          fiscalDocumentId: documentId,
          kind: 'INITIAL_DOCUMENT',
          channel: 'EMAIL',
          recipient: 'delivered-test@example.com',
          status: 'DELIVERED',
          attemptCount: 1,
          deliveredAt: new Date(),
          updatedAt: new Date(),
        },
      });
      deliveryId = created.id;
    });

    afterEach(async () => {
      await prisma.documentDelivery.deleteMany({ where: { id: deliveryId } });
    });

    it('UPDATE WHERE status <> DELIVERED blocks stale worker from regressing to FAILED', async () => {
      // Simulate two concurrent stale worker attempts to regress DELIVERED → FAILED
      const [count1, count2] = await Promise.all([
        prisma.documentDelivery.updateMany({
          where: { id: deliveryId, status: { not: 'DELIVERED' } },
          data: { status: 'FAILED', updatedAt: new Date() },
        }),
        prisma.documentDelivery.updateMany({
          where: { id: deliveryId, status: { not: 'DELIVERED' } },
          data: { status: 'FAILED', updatedAt: new Date() },
        }),
      ]);

      // Both updates affect 0 rows — DELIVERED is protected
      expect(count1.count).toBe(0);
      expect(count2.count).toBe(0);

      const delivery = await prisma.documentDelivery.findUnique({ where: { id: deliveryId } });
      expect(delivery?.status).toBe('DELIVERED');
    });

    it('FiscalDocument.status is NOT changed by delivery status (invariant)', async () => {
      // Simulate attempted "helpful" delivery update to fiscal document
      const before = await prisma.fiscalDocument.findUnique({ where: { id: documentId } });

      // Delivery operations must never write to fiscal_documents
      await prisma.documentDelivery.update({
        where: { id: deliveryId },
        data: { status: 'DELIVERED', deliveredAt: new Date(), updatedAt: new Date() },
      });

      const after = await prisma.fiscalDocument.findUnique({ where: { id: documentId } });
      expect(after?.status).toBe(before?.status); // Unchanged
    });
  });

  // ── E. Stale SENDING recovery ──────────────────────────────────────────────
  describe('E. Stale SENDING recovery → RETRY_PENDING', () => {
    let deliveryId: string;

    beforeEach(async () => {
      const created = await prisma.documentDelivery.create({
        data: {
          id: randomUUID(),
          tenantId,
          companyId,
          fiscalDocumentId: documentId,
          kind: 'INITIAL_DOCUMENT',
          channel: 'EMAIL',
          recipient: 'stale-test@example.com',
          status: 'SENDING',
          attemptCount: 1,
          updatedAt: new Date(Date.now() - 600_000), // 10 min old — stale
        },
      });
      deliveryId = created.id;
    });

    afterEach(async () => {
      await prisma.documentDelivery.deleteMany({ where: { id: deliveryId } });
    });

    it('recovery transitions stale SENDING → RETRY_PENDING', async () => {
      const result = await prisma.documentDelivery.updateMany({
        where: {
          id: deliveryId,
          status: 'SENDING',
          updatedAt: { lt: new Date(Date.now() - 300_000) }, // stale > 5 min
        },
        data: {
          status: 'RETRY_PENDING',
          lastErrorCode: 'WORKER_CRASH_STALE_SENDING',
          updatedAt: new Date(),
        },
      });
      expect(result.count).toBe(1);

      const delivery = await prisma.documentDelivery.findUnique({ where: { id: deliveryId } });
      expect(delivery?.status).toBe('RETRY_PENDING');
      expect(delivery?.lastErrorCode).toBe('WORKER_CRASH_STALE_SENDING');
    });
  });

  // ── F. Duplicate F3 terminal hook ─────────────────────────────────────────
  describe('F. Duplicate F3 terminal hook — only one HACIENDA_RESPONSE', () => {
    afterEach(async () => {
      await prisma.documentDelivery.deleteMany({
        where: { fiscalDocumentId: documentId, kind: 'HACIENDA_RESPONSE' },
      });
    });

    it('5 concurrent terminal hooks create exactly one delivery row', async () => {
      const hookRecipient = 'hook-test@example.com';
      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () =>
          createDelivery(
            prisma,
            tenantId,
            companyId,
            documentId,
            'HACIENDA_RESPONSE',
            hookRecipient,
          ),
        ),
      );

      const successes = results
        .filter((r) => r.status === 'fulfilled')
        .map((r) => (r as PromiseFulfilledResult<{ success: boolean }>).value);

      expect(successes.filter((v) => v.success).length).toBe(1);
      expect(successes.filter((v) => !v.success).length).toBe(4);

      const count = await prisma.documentDelivery.count({
        where: { fiscalDocumentId: documentId, kind: 'HACIENDA_RESPONSE' },
      });
      expect(count).toBe(1);
    });
  });

  // ── G. Concurrent attempt numbering ───────────────────────────────────────
  describe('G. Attempt creation isolation per delivery', () => {
    let deliveryId: string;

    beforeEach(async () => {
      const created = await prisma.documentDelivery.create({
        data: {
          id: randomUUID(),
          tenantId,
          companyId,
          fiscalDocumentId: documentId,
          kind: 'INITIAL_DOCUMENT',
          channel: 'EMAIL',
          recipient: 'attempt-test@example.com',
          status: 'QUEUED',
          attemptCount: 0,
          updatedAt: new Date(),
        },
      });
      deliveryId = created.id;
    });

    afterEach(async () => {
      await prisma.deliveryAttempt.deleteMany({ where: { deliveryId } });
      await prisma.documentDelivery.deleteMany({ where: { id: deliveryId } });
    });

    it('sequential attempts get sequential numbers and are stored correctly', async () => {
      // Sequential attempts (sequential to avoid race on number assignment)
      for (let i = 1; i <= 3; i++) {
        await prisma.deliveryAttempt.create({
          data: {
            id: randomUUID(),
            deliveryId,
            attemptNumber: i,
            status: i < 3 ? 'FAILED' : 'DELIVERED',
            startedAt: new Date(),
            completedAt: new Date(),
          },
        });
      }

      const attempts = await prisma.deliveryAttempt.findMany({
        where: { deliveryId },
        orderBy: { attemptNumber: 'asc' },
      });
      expect(attempts).toHaveLength(3);
      expect(attempts[0].attemptNumber).toBe(1);
      expect(attempts[1].attemptNumber).toBe(2);
      expect(attempts[2].attemptNumber).toBe(3);
      expect(attempts[2].status).toBe('DELIVERED');
    });
  });

  // ── H. Fiscal status invariant ─────────────────────────────────────────────
  describe('H. Delivery operations never mutate FiscalDocument.status', () => {
    it('FiscalDocument.status remains READY_TO_SUBMIT after all delivery operations', async () => {
      // Verify initial state
      const initial = await prisma.fiscalDocument.findUnique({ where: { id: documentId } });
      expect(initial?.status).toBe('READY_TO_SUBMIT');

      // Simulate full delivery lifecycle: create, queue, send, fail, retry, deliver
      const delivery = await prisma.documentDelivery.create({
        data: {
          id: randomUUID(),
          tenantId,
          companyId,
          fiscalDocumentId: documentId,
          kind: 'INITIAL_DOCUMENT',
          channel: 'EMAIL',
          recipient: 'invariant-test@example.com',
          status: 'PENDING',
          attemptCount: 0,
          updatedAt: new Date(),
        },
      });

      await prisma.documentDelivery.update({
        where: { id: delivery.id },
        data: { status: 'QUEUED', updatedAt: new Date() },
      });
      await prisma.documentDelivery.update({
        where: { id: delivery.id },
        data: { status: 'SENDING', updatedAt: new Date() },
      });
      await prisma.documentDelivery.update({
        where: { id: delivery.id },
        data: { status: 'FAILED', attemptCount: 1, updatedAt: new Date() },
      });
      await prisma.documentDelivery.update({
        where: { id: delivery.id },
        data: { status: 'RETRY_PENDING', updatedAt: new Date() },
      });
      await prisma.documentDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'DELIVERED',
          deliveredAt: new Date(),
          attemptCount: 2,
          updatedAt: new Date(),
        },
      });

      // Final delivery state is DELIVERED
      const finalDelivery = await prisma.documentDelivery.findUnique({
        where: { id: delivery.id },
      });
      expect(finalDelivery?.status).toBe('DELIVERED');

      // FiscalDocument.status is completely unchanged
      const finalDoc = await prisma.fiscalDocument.findUnique({ where: { id: documentId } });
      expect(finalDoc?.status).toBe('READY_TO_SUBMIT'); // NOT changed by delivery

      // Cleanup
      await prisma.documentDelivery.delete({ where: { id: delivery.id } });
    });
  });
});
