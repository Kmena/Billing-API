import { ValueObject } from '../../../shared/domain/value-object';

interface EmailProps {
  value: string;
}

export class Email extends ValueObject<EmailProps> {
  private static readonly EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  private static readonly MAX_LENGTH = 255;

  get value(): string {
    return this.props.value;
  }

  private constructor(props: EmailProps) {
    super(props);
  }

  static create(email: string): Email {
    const normalized = email.trim().toLowerCase();

    if (!normalized || normalized.length === 0) {
      throw new Error('Email address cannot be empty.');
    }

    if (normalized.length > Email.MAX_LENGTH) {
      throw new Error(`Email address must not exceed ${Email.MAX_LENGTH} characters.`);
    }

    if (!Email.EMAIL_REGEX.test(normalized)) {
      throw new Error(`'${normalized}' is not a valid email address.`);
    }

    return new Email({ value: normalized });
  }
}
