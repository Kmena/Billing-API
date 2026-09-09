import { ValueObject } from '../../../shared/domain/value-object';

export type IdentificationTypeValue = 'FISICA' | 'JURIDICA' | 'DIMEX' | 'NITE';

interface IdentificationTypeProps {
  value: IdentificationTypeValue;
}

const VALID_TYPES: readonly IdentificationTypeValue[] = ['FISICA', 'JURIDICA', 'DIMEX', 'NITE'];

export class IdentificationType extends ValueObject<IdentificationTypeProps> {
  get value(): IdentificationTypeValue {
    return this.props.value;
  }

  private constructor(props: IdentificationTypeProps) {
    super(props);
  }

  static create(type: string): IdentificationType {
    const normalized = type.toUpperCase() as IdentificationTypeValue;

    if (!VALID_TYPES.includes(normalized)) {
      throw new Error(
        `Invalid identification type '${type}'. Must be one of: ${VALID_TYPES.join(', ')}.`,
      );
    }

    return new IdentificationType({ value: normalized });
  }
}
