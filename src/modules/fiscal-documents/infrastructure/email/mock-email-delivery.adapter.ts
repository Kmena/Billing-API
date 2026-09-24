/**
 * MockEmailDeliveryAdapter — Deterministic CI email adapter.
 *
 * Used in test and CI environments only.
 * Configurable to simulate all delivery outcomes without network calls.
 * Captures sent email records for test assertion.
 * Must NEVER be used in production.
 */
import { Injectable } from '@nestjs/common';
import {
  EmailDeliveryPort,
  SendEmailCommand,
  SendEmailResult,
  EmailDeliveryOutcome,
} from '../../application/email/email-delivery.port';

export interface MockEmailRecord {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly attachmentFilenames: ReadonlyArray<string>;
  readonly sentAt: Date;
}

@Injectable()
export class MockEmailDeliveryAdapter implements EmailDeliveryPort {
  private _sentEmails: MockEmailRecord[] = [];
  private _simulatedOutcome: EmailDeliveryOutcome = 'DELIVERED';
  private _simulatedRetryAfter?: number;

  /**
   * Configure simulated outcome for tests.
   * @param outcome - Outcome to return on next sendEmail call(s).
   * @param retryAfterSeconds - Retry-After hint (for rate limiting simulation).
   */
  configureOutcome(outcome: EmailDeliveryOutcome, retryAfterSeconds?: number): void {
    this._simulatedOutcome = outcome;
    this._simulatedRetryAfter = retryAfterSeconds;
  }

  /** Access sent email records for test assertions. */
  get sentEmails(): ReadonlyArray<MockEmailRecord> {
    return this._sentEmails;
  }

  /** Clear sent email history. */
  clearSentEmails(): void {
    this._sentEmails = [];
  }

  async sendEmail(command: SendEmailCommand): Promise<SendEmailResult> {
    // Record the send attempt (without storing attachment bytes — security)
    this._sentEmails.push({
      to: command.to,
      subject: command.subject,
      text: command.text,
      attachmentFilenames: command.attachments.map((a) => a.filename),
      sentAt: new Date(),
    });

    const outcome = this._simulatedOutcome;

    switch (outcome) {
      case 'DELIVERED':
        return {
          outcome: 'DELIVERED',
          providerMessageId: `mock-msg-${Date.now()}`,
        };

      case 'TRANSIENT_FAILURE':
        return {
          outcome: 'TRANSIENT_FAILURE',
          sanitizedErrorCode: 'MOCK_TRANSIENT_FAILURE',
          sanitizedErrorMessage: 'Mock transient provider failure',
        };

      case 'PERMANENT_FAILURE':
        return {
          outcome: 'PERMANENT_FAILURE',
          sanitizedErrorCode: 'MOCK_PERMANENT_FAILURE',
          sanitizedErrorMessage: 'Mock permanent recipient rejection (hard bounce)',
        };

      case 'RATE_LIMITED':
        return {
          outcome: 'RATE_LIMITED',
          sanitizedErrorCode: 'MOCK_RATE_LIMITED',
          sanitizedErrorMessage: 'Mock rate limit exceeded',
          retryAfterSeconds: this._simulatedRetryAfter ?? 60,
        };

      case 'UNKNOWN':
        return {
          outcome: 'UNKNOWN',
          sanitizedErrorCode: 'MOCK_UNKNOWN',
          sanitizedErrorMessage: 'Mock unknown provider response',
        };

      default:
        return {
          outcome: 'UNKNOWN',
          sanitizedErrorCode: 'MOCK_DEFAULT',
          sanitizedErrorMessage: 'Mock adapter: unexpected outcome',
        };
    }
  }
}
