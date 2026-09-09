import { AuditService } from '../audit.service';
import { IAuditLogRepository } from '../../domain/ports/audit-log.repository';
import { AuditLog } from '../../domain/entities/audit-log.entity';
import { Logger } from '@nestjs/common';

describe('AuditService', () => {
  let service: AuditService;
  let mockRepository: jest.Mocked<IAuditLogRepository>;

  beforeEach(() => {
    mockRepository = {
      insert: jest.fn(),
      findByCorrelationId: jest.fn(),
      findByTenant: jest.fn(),
    };

    service = new AuditService(mockRepository);

    // Suppress logger output in tests
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('record()', () => {
    it('calls repository.insert with an AuditLog', async () => {
      mockRepository.insert.mockResolvedValue(undefined);

      service.record({
        action: 'test.action',
        correlationId: 'corr-id-1',
        eventClass: 'TECHNICAL',
      });

      // Wait for the fire-and-forget to settle
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockRepository.insert).toHaveBeenCalledTimes(1);
      const inserted = mockRepository.insert.mock.calls[0][0] as AuditLog;
      expect(inserted.action).toBe('test.action');
      expect(inserted.correlationId).toBe('corr-id-1');
      expect(inserted.id).toBeDefined();
    });

    it('does not throw if repository.insert fails (fire-and-forget)', async () => {
      mockRepository.insert.mockRejectedValue(new Error('DB connection lost'));

      expect(() =>
        service.record({
          action: 'test.action',
          eventClass: 'TECHNICAL',
        }),
      ).not.toThrow();

      // Wait for the async failure to be handled
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should have logged the error internally
      expect(Logger.prototype.error).toHaveBeenCalled();
    });
  });

  describe('findByCorrelationId()', () => {
    it('delegates to repository', async () => {
      const mockLogs: AuditLog[] = [];
      mockRepository.findByCorrelationId.mockResolvedValue(mockLogs);

      const result = await service.findByCorrelationId('corr-id-1');

      expect(result).toBe(mockLogs);
      expect(mockRepository.findByCorrelationId).toHaveBeenCalledWith('corr-id-1');
    });
  });
});
