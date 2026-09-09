import { ValueObject } from '../../../shared/domain/value-object';
import { IdentificationTypeValue } from './identification-type.vo';

interface IdentificationNumberProps {
  value: string;
  type: IdentificationTypeValue;
}

/**
 * Validates the Costa Rica identification number format by type.
 * BR: FISICA (9 digits), JURIDICA (10 digits), DIMEX (11-12 digits), NITE (10 digits)
 */
const VALIDATION_RULES: Record<
  IdentificationTypeValue,
  { minLength: number; maxLength: number; label: string }
> = {
  FISICA: { minLength: 9, maxLength: 9, label: 'Cédula física (9 digits)' },
  JURIDICA: { minLength: 10, maxLength: 10, label: 'Cédula jurídica (10 digits)' },
  DIMEX: { minLength: 11, maxLength: 12, label: 'DIMEX (11-12 digits)' },
  NITE: { minLength: 10, maxLength: 10, label: 'NITE (10 digits)' },
};

export class IdentificationNumber extends ValueObject<IdentificationNumberProps> {
  get value(): string {
    return this.props.value;
  }

  get type(): IdentificationTypeValue {
    return this.props.type;
  }

  private constructor(props: IdentificationNumberProps) {
    super(props);
  }

  static create(number: string, type: IdentificationTypeValue): IdentificationNumber {
    const cleaned = number.replace(/\D/g, ''); // Remove non-digits
    const rule = VALIDATION_RULES[type];

    if (!cleaned || cleaned.length === 0) {
      throw new Error(`Identification number cannot be empty.`);
    }

    if (!/^\d+$/.test(cleaned)) {
      throw new Error(`Identification number must contain only digits. Got '${number}'.`);
    }

    if (cleaned.length < rule.minLength || cleaned.length > rule.maxLength) {
      const lengthDesc =
        rule.minLength === rule.maxLength
          ? `${rule.minLength} digits`
          : `${rule.minLength}-${rule.maxLength} digits`;
      throw new Error(
        `${rule.label} must have ${lengthDesc}. Got '${cleaned}' (${cleaned.length} digits).`,
      );
    }

    return new IdentificationNumber({ value: cleaned, type });
  }
}
