/**
 * NodemailerEmailDeliveryAdapter — Production email adapter using Nodemailer/SMTP.
 *
 * Implements EmailDeliveryPort with SMTP transport.
 * Credentials loaded from configuration/SecretProvider — never hardcoded.
 * All provider error information sanitized before returning.
 * Attachment bytes attached server-side from verified artifact content.
 *
 * Provider decision: SMTP (Nodemailer) — covers SendGrid/SES/SMTP/Resend via SMTP relay.
 * This adapter uses SMTP for maximum provider flexibility.
 * See decisions.md for email provider selection rationale.
 */
import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import {
  EmailDeliveryPort,
  SendEmailCommand,
  SendEmailResult,
} from '../../application/email/email-delivery.port';

export interface SmtpConfig {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly user: string;
  readonly password: string;
  readonly fromAddress: string;
  readonly fromName: string;
}

@Injectable()
export class NodemailerEmailDeliveryAdapter implements EmailDeliveryPort {
  private readonly logger = new Logger(NodemailerEmailDeliveryAdapter.name);
  private readonly transporter: nodemailer.Transporter;
  private readonly fromAddress: string;

  constructor(config: SmtpConfig) {
    this.fromAddress = `"${config.fromName}" <${config.fromAddress}>`;
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.user,
        pass: config.password,
      },
      // Security: disable arbitrary TLS options; use system CA
      tls: {
        rejectUnauthorized: true,
      },
    });
  }

  async sendEmail(command: SendEmailCommand): Promise<SendEmailResult> {
    // Validate recipient to prevent header injection
    if (!this.isValidEmail(command.to)) {
      return {
        outcome: 'PERMANENT_FAILURE',
        sanitizedErrorCode: 'INVALID_RECIPIENT_FORMAT',
        sanitizedErrorMessage: 'Recipient email address failed format validation.',
      };
    }

    try {
      const info = await this.transporter.sendMail({
        from: this.fromAddress,
        to: command.to,
        subject: command.subject,
        text: command.text,
        html: command.html,
        attachments: command.attachments.map((a) => ({
          filename: a.filename,
          content: a.content,
          contentType: a.contentType,
        })),
      });

      this.logger.log({
        msg: 'Email sent successfully',
        messageId: info.messageId,
        to: command.to.substring(0, 3) + '***', // Partial redaction for logs
      });

      return {
        outcome: 'DELIVERED',
        providerMessageId: info.messageId ? String(info.messageId).substring(0, 255) : undefined,
      };
    } catch (error: unknown) {
      return this.classifyNodemailerError(error);
    }
  }

  private classifyNodemailerError(error: unknown): SendEmailResult {
    if (!error || typeof error !== 'object') {
      return {
        outcome: 'UNKNOWN',
        sanitizedErrorCode: 'SMTP_UNKNOWN_ERROR',
        sanitizedErrorMessage: 'Unknown error during email delivery.',
      };
    }

    const err = error as Record<string, unknown>;
    const code = typeof err['code'] === 'string' ? err['code'] : undefined;
    const responseCode = typeof err['responseCode'] === 'number' ? err['responseCode'] : undefined;

    // Network/connection errors → transient
    if (
      code === 'ECONNREFUSED' ||
      code === 'ETIMEDOUT' ||
      code === 'ENOTFOUND' ||
      code === 'ECONNRESET'
    ) {
      return {
        outcome: 'TRANSIENT_FAILURE',
        sanitizedErrorCode: `SMTP_NETWORK_${code ?? 'ERROR'}`,
        sanitizedErrorMessage: 'Network error connecting to SMTP server.',
      };
    }

    // Permanent recipient rejection (550, 551, 553)
    if (responseCode !== undefined && [550, 551, 553].includes(responseCode)) {
      return {
        outcome: 'PERMANENT_FAILURE',
        sanitizedErrorCode: 'SMTP_RECIPIENT_REJECTED',
        sanitizedErrorMessage: `SMTP server permanently rejected recipient (code ${responseCode}).`,
      };
    }

    // Rate limiting (421, 450)
    if (responseCode !== undefined && [421, 450].includes(responseCode)) {
      return {
        outcome: 'RATE_LIMITED',
        sanitizedErrorCode: 'SMTP_RATE_LIMITED',
        sanitizedErrorMessage: `SMTP server temporarily unavailable (code ${responseCode}).`,
        retryAfterSeconds: 60,
      };
    }

    // Authentication failure → config error
    if (code === 'EAUTH' || (responseCode !== undefined && responseCode === 535)) {
      return {
        outcome: 'PERMANENT_FAILURE',
        sanitizedErrorCode: 'SMTP_AUTH_FAILURE',
        sanitizedErrorMessage: 'SMTP authentication failed — check credentials configuration.',
      };
    }

    // Default: unknown
    this.logger.warn({
      msg: 'Unclassified SMTP error',
      code,
      responseCode,
    });

    return {
      outcome: 'UNKNOWN',
      sanitizedErrorCode: 'SMTP_UNCLASSIFIED',
      sanitizedErrorMessage: 'Unclassified SMTP error during email delivery.',
    };
  }

  /** Basic email format validation to prevent header injection. */
  private isValidEmail(email: string): boolean {
    // RFC 5321 simplified: no newlines, @ present, reasonable length
    if (!email || email.length > 320) return false;
    if (email.includes('\n') || email.includes('\r') || email.includes('\0')) return false;
    const parts = email.split('@');
    return parts.length === 2 && parts[0].length > 0 && parts[1].length > 0;
  }
}
