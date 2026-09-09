import { InMemoryJobQueue } from '../adapters/in-memory-job-queue.adapter';

describe('InMemoryJobQueue', () => {
  let queue: InMemoryJobQueue;

  beforeEach(() => {
    queue = new InMemoryJobQueue();
  });

  describe('publish() with registered handler', () => {
    it('executes the handler synchronously when a job is published', async () => {
      const received: unknown[] = [];
      queue.register<{ value: string }>('test-job', async (payload) => {
        received.push(payload);
      });

      await queue.publish('test-job', { value: 'hello' });

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({ value: 'hello' });
    });

    it('does not throw when no handler is registered', async () => {
      await expect(queue.publish('unknown-job', { data: 'test' })).resolves.not.toThrow();
    });
  });

  describe('schedule()', () => {
    it('completes without error (no-op in test mode)', async () => {
      await expect(queue.schedule('scheduled-job', '0 * * * *', {})).resolves.not.toThrow();
    });
  });
});
